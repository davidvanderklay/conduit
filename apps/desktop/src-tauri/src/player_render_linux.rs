// The GTK/libmpv rendering structure is adapted from Harbor's MIT-licensed
// Tauri player implementation: https://github.com/harborstremio/harbor
#![cfg(target_os = "linux")]

use gtk::{
    gdk, glib,
    glib::{
        translate::{Stash, ToGlibPtr},
        ObjectExt,
    },
    prelude::*,
    Allocation, GLArea, Overlay, Widget,
};
use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2_sys::mpv_handle;
use std::{
    cell::{Cell, RefCell},
    ffi::{c_char, c_void, CString},
    ptr::NonNull,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::WebviewWindow;

const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

struct EmbeddedSurface {
    area: GLArea,
    overlay: Overlay,
    webview: Widget,
    window: gtk::ApplicationWindow,
    render: Option<RenderContext>,
}

thread_local! {
    static SURFACE: RefCell<Option<EmbeddedSurface>> = const { RefCell::new(None) };
}

static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);
static WEBVIEW_RESET_PENDING: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
    fn gdk_x11_display_get_xdisplay(display: *mut c_void) -> *mut c_void;
    fn gdk_wayland_display_get_wl_display(display: *mut c_void) -> *mut c_void;
}

const RTLD_DEFAULT: *mut c_void = std::ptr::null_mut();

pub fn initialize(window: &WebviewWindow) -> Result<(), String> {
    if SURFACE.with(|surface| surface.borrow().is_some()) {
        return Ok(());
    }
    let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
    let vbox = window.default_vbox().map_err(|error| error.to_string())?;
    let webview = vbox
        .children()
        .into_iter()
        .next()
        .ok_or_else(|| "Tauri window has no WebKit widget".to_owned())?;

    apply_rgba_visual(&gtk_window);
    set_webview_background(&webview, 1.0);
    gtk_window.remove(&vbox);
    vbox.remove(&webview);

    let area = GLArea::new();
    area.set_auto_render(false);
    area.set_use_es(false);
    area.set_has_depth_buffer(false);
    area.set_has_stencil_buffer(false);
    area.set_app_paintable(true);
    area.set_hexpand(true);
    area.set_vexpand(true);
    area.connect_render(|_, _| {
        let _ = render();
        glib::Propagation::Stop
    });
    area.connect_resize(|area, _, _| area.queue_render());

    let overlay = Overlay::new();
    overlay.set_hexpand(true);
    overlay.set_vexpand(true);
    overlay.add(&area);
    overlay.add_overlay(&webview);
    overlay.set_overlay_pass_through(&webview, false);
    webview.set_hexpand(true);
    webview.set_vexpand(true);
    gtk_window.add(&overlay);
    overlay.show_all();
    gtk_window.show_all();
    area.set_opacity(0.0);

    SURFACE.with(|surface| {
        *surface.borrow_mut() = Some(EmbeddedSurface {
            area,
            overlay,
            webview,
            window: gtk_window,
            render: None,
        });
    });
    Ok(())
}

pub fn install(context: NonNull<mpv_handle>, window: &WebviewWindow) -> Result<(), String> {
    initialize(window)?;
    uninstall()?;

    let area = SURFACE.with(|surface| {
        surface
            .borrow()
            .as_ref()
            .map(|surface| surface.area.clone())
            .ok_or_else(|| "Linux render surface is unavailable".to_owned())
    })?;
    area.make_current();
    if let Some(error) = area.error() {
        return Err(format!("OpenGL context creation failed: {error}"));
    }

    let mut parameters = vec![
        RenderParam::ApiType(RenderParamApiType::OpenGl),
        RenderParam::InitParams(OpenGLInitParams::<()> {
            get_proc_address,
            ctx: (),
        }),
    ];
    if let Some((wayland, display)) = native_display() {
        if wayland {
            parameters.push(RenderParam::WaylandDisplay(display));
        } else {
            parameters.push(RenderParam::X11Display(display));
        }
    }
    let mut render = match RenderContext::new(unsafe { &mut *context.as_ptr() }, parameters) {
        Ok(render) => render,
        Err(error) => return Err(format!("libmpv render context: {error:?}")),
    };
    render.set_update_callback(schedule_redraw);

    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow_mut().as_mut() {
            set_webview_background(&surface.webview, 0.0);
            surface.webview.set_opacity(1.0);
            surface.render = Some(render);
            surface.area.set_opacity(1.0);
            surface.overlay.queue_draw();
            surface.webview.queue_draw();
            surface.area.queue_render();
            force_configure(surface);
        }
    });
    schedule_redraw();
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    REDRAW_PENDING.store(false, Ordering::Release);

    // libmpv requires every OpenGL render operation, including destruction of
    // the render context, to run with the same GL context current. Taking the
    // renderer out first also avoids holding the RefCell borrow while libmpv
    // synchronously tears down an active video output.
    let render = SURFACE.with(|surface| {
        let mut surface = surface.borrow_mut();
        let Some(surface) = surface.as_mut() else {
            return Ok(None);
        };
        surface.area.make_current();
        if let Some(error) = surface.area.error() {
            return Err(format!(
                "OpenGL context activation during teardown failed: {error}"
            ));
        }
        Ok(surface.render.take())
    })?;

    #[cfg(debug_assertions)]
    eprintln!("Conduit: releasing Linux video render context");
    drop(render);
    #[cfg(debug_assertions)]
    eprintln!("Conduit: Linux video render context released");

    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow().as_ref() {
            surface.area.set_opacity(0.0);
            surface.webview.set_opacity(1.0);
            set_webview_background(&surface.webview, 1.0);
            surface.webview.queue_draw();
            surface.overlay.queue_draw();
            force_configure(surface);
        }
    });
    Ok(())
}

fn force_configure(surface: &EmbeddedSurface) {
    let fullscreen = surface
        .window
        .window()
        .is_some_and(|window| window.state().contains(gdk::WindowState::FULLSCREEN));
    if fullscreen {
        let window = surface.window.clone();
        window.unfullscreen();
        glib::idle_add_local_once(move || {
            window.fullscreen();
            window.queue_draw();
        });
        return;
    }
    if surface.window.is_maximized() {
        let window = surface.window.clone();
        window.unmaximize();
        glib::idle_add_local_once(move || {
            window.maximize();
            window.queue_draw();
        });
        return;
    }
    let width = surface.window.allocated_width().max(2);
    let height = surface.window.allocated_height().max(2);
    let window = surface.window.clone();
    window.resize(width - 1, height);
    glib::idle_add_local_once(move || {
        window.resize(width, height);
        window.queue_draw();
    });
}

pub fn reconfigure() {
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow().as_ref() {
            force_configure(surface);
        }
    });
}

pub fn refresh() {
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow().as_ref() {
            surface.overlay.queue_draw();
            // WebKitGTK's damage region only covers the new bounds of moving
            // controls when the WebView is transparent over GtkGLArea. Force
            // the entire overlay allocation to be repainted so old slider
            // thumbs and timestamp glyphs are cleared as well.
            surface.webview.queue_draw_area(
                0,
                0,
                surface.webview.allocated_width().max(1),
                surface.webview.allocated_height().max(1),
            );
            surface.area.queue_render();
        }
    });
}

pub fn reset_webview() {
    if WEBVIEW_RESET_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }

    let widgets = SURFACE.with(|surface| {
        surface.borrow().as_ref().map(|surface| {
            (
                surface.webview.clone(),
                surface.overlay.clone(),
                surface.area.clone(),
            )
        })
    });
    let Some((webview, overlay, area)) = widgets else {
        WEBVIEW_RESET_PENDING.store(false, Ordering::Release);
        return;
    };

    // Fullscreen changes clear stale transparent WebKit pixels because they
    // replace its backing allocation. Reproduce that effect on the WebView
    // alone while it is invisible, without changing window geometry.
    let allocation = webview.allocation();
    let nudged = Allocation::new(
        allocation.x(),
        allocation.y(),
        (allocation.width() - 1).max(1),
        allocation.height().max(1),
    );
    webview.set_opacity(0.0);
    webview.size_allocate(&nudged);
    webview.queue_draw();
    overlay.queue_draw();
    area.queue_render();

    // Advance on GTK frame-clock ticks so both hidden allocations are
    // presented before the clean full-size WebView becomes visible again.
    let stage = Cell::new(0_u8);
    overlay.add_tick_callback(move |overlay, _| match stage.get() {
        0 => {
            stage.set(1);
            glib::ControlFlow::Continue
        }
        1 => {
            webview.size_allocate(&allocation);
            webview.queue_draw();
            overlay.queue_draw();
            area.queue_render();
            stage.set(2);
            glib::ControlFlow::Continue
        }
        _ => {
            webview.set_opacity(1.0);
            webview.queue_draw();
            overlay.queue_draw();
            area.queue_render();
            WEBVIEW_RESET_PENDING.store(false, Ordering::Release);
            glib::ControlFlow::Break
        }
    });
}

fn schedule_redraw() {
    if REDRAW_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    glib::idle_add_once(|| {
        REDRAW_PENDING.store(false, Ordering::Release);
        refresh();
    });
}

fn render() -> Result<(), String> {
    SURFACE.with(|surface| {
        let surface = surface.borrow();
        let Some(surface) = surface.as_ref() else {
            return Ok(());
        };
        surface.area.make_current();
        surface.area.attach_buffers();
        if let Some(error) = surface.area.error() {
            return Err(format!("OpenGL context failed: {error}"));
        }
        let scale = surface.area.scale_factor().max(1);
        let width = (surface.area.allocated_width() * scale).max(1);
        let height = (surface.area.allocated_height() * scale).max(1);
        let Some(render) = surface.render.as_ref() else {
            return Ok(());
        };
        render
            .render::<()>(current_framebuffer(), width, height, true)
            .map_err(|error| format!("libmpv render: {error:?}"))
    })
}

fn current_framebuffer() -> i32 {
    type GetInteger = unsafe extern "C" fn(u32, *mut i32);
    let Some(get_integer) = resolve_gl::<GetInteger>("glGetIntegerv") else {
        return 0;
    };
    let mut framebuffer = 0;
    unsafe { get_integer(GL_FRAMEBUFFER_BINDING, &mut framebuffer) };
    framebuffer
}

fn native_display() -> Option<(bool, *const c_void)> {
    let display = gdk::Display::default()?;
    let wayland = display.type_().name().contains("Wayland");
    let display_stash: Stash<'_, *mut gdk::ffi::GdkDisplay, gdk::Display> = display.to_glib_none();
    let raw = display_stash.0 as *mut c_void;
    let native = unsafe {
        if wayland {
            gdk_wayland_display_get_wl_display(raw)
        } else {
            gdk_x11_display_get_xdisplay(raw)
        }
    };
    (!native.is_null()).then_some((wayland, native.cast_const()))
}

fn resolve_gl<T: Copy>(name: &str) -> Option<T> {
    let pointer = get_proc_address(&(), name);
    if pointer.is_null() {
        None
    } else {
        Some(unsafe { std::mem::transmute_copy(&pointer) })
    }
}

fn apply_rgba_visual(window: &gtk::ApplicationWindow) {
    if let Some(screen) = GtkWindowExt::screen(window) {
        if let Some(visual) = screen.rgba_visual() {
            window.set_visual(Some(&visual));
            window.set_app_paintable(true);
        }
    }
}

fn set_webview_background(webview: &Widget, alpha: f64) {
    #[repr(C)]
    struct Rgba {
        red: f64,
        green: f64,
        blue: f64,
        alpha: f64,
    }
    type SetBackground = unsafe extern "C" fn(*mut c_void, *const Rgba);
    let Some(set_background) =
        resolve_symbol::<SetBackground>("webkit_web_view_set_background_color")
    else {
        return;
    };
    let widget_stash: Stash<'_, *mut gtk::ffi::GtkWidget, Widget> = webview.to_glib_none();
    let color = Rgba {
        red: 0.0,
        green: 0.0,
        blue: 0.0,
        alpha,
    };
    unsafe {
        set_background(widget_stash.0.cast(), &color);
    }
}

fn resolve_symbol<T: Copy>(name: &str) -> Option<T> {
    let name = CString::new(name).ok()?;
    let pointer = unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) };
    (!pointer.is_null()).then(|| unsafe { std::mem::transmute_copy(&pointer) })
}

fn get_proc_address(_: &(), name: &str) -> *mut c_void {
    CString::new(name)
        .map(|name| unsafe {
            let symbol = dlsym(RTLD_DEFAULT, name.as_ptr());
            if symbol.is_null() {
                eglGetProcAddress(name.as_ptr())
            } else {
                symbol
            }
        })
        .unwrap_or(std::ptr::null_mut())
}
