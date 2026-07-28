// The GTK/libmpv rendering structure is adapted from Harbor's MIT-licensed
// Tauri player implementation: https://github.com/harborstremio/harbor
#![cfg(target_os = "linux")]

use gtk::{
    gdk, glib,
    glib::{
        translate::{IntoGlib, Stash, ToGlibPtr},
        ObjectExt,
    },
    prelude::{BoxExt, ContainerExt, GLAreaExt, OverlayExt, WidgetExt},
    GLArea, Overlay, Widget,
};
use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2_sys::mpv_handle;
use std::{
    cell::RefCell,
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
    vbox: gtk::Box,
    webview_position: i32,
    blocked_button_handlers: bool,
    render: RenderContext,
}

thread_local! {
    static SURFACE: RefCell<Option<EmbeddedSurface>> = const { RefCell::new(None) };
}

static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
    fn gdk_x11_display_get_xdisplay(display: *mut c_void) -> *mut c_void;
    fn gdk_wayland_display_get_wl_display(display: *mut c_void) -> *mut c_void;
}

const RTLD_DEFAULT: *mut c_void = std::ptr::null_mut();

pub fn install(context: NonNull<mpv_handle>, window: &WebviewWindow) -> Result<(), String> {
    uninstall()?;

    let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
    let vbox = window.default_vbox().map_err(|error| error.to_string())?;
    let children = vbox.children();
    let webview = children
        .last()
        .cloned()
        .ok_or_else(|| "Tauri window has no WebKit widget".to_owned())?;
    let webview_position = children
        .iter()
        .position(|child| child == &webview)
        .unwrap_or_default() as i32;
    let blocked_button_handlers = set_button_handlers_blocked(&webview, true);

    vbox.remove(&webview);

    let area = GLArea::new();
    area.set_auto_render(false);
    area.set_has_depth_buffer(false);
    area.set_hexpand(true);
    area.set_vexpand(true);
    area.connect_render(|_, _| {
        let _ = render();
        glib::Propagation::Stop
    });

    let overlay = Overlay::new();
    overlay.set_hexpand(true);
    overlay.set_vexpand(true);
    overlay.add(&area);
    overlay.add_overlay(&webview);
    webview.set_hexpand(true);
    webview.set_vexpand(true);
    vbox.pack_start(&overlay, true, true, 0);
    vbox.reorder_child(&overlay, webview_position);
    overlay.show_all();
    gtk_window.show_all();

    area.make_current();
    if let Some(error) = area.error() {
        restore_layout(&vbox, &overlay, &webview, webview_position);
        if blocked_button_handlers {
            set_button_handlers_blocked(&webview, false);
        }
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
        Err(error) => {
            restore_layout(&vbox, &overlay, &webview, webview_position);
            if blocked_button_handlers {
                set_button_handlers_blocked(&webview, false);
            }
            return Err(format!("libmpv render context: {error:?}"));
        }
    };
    render.set_update_callback(schedule_redraw);

    SURFACE.with(|surface| {
        *surface.borrow_mut() = Some(EmbeddedSurface {
            area,
            overlay,
            webview,
            vbox,
            webview_position,
            blocked_button_handlers,
            render,
        });
    });
    schedule_redraw();
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    REDRAW_PENDING.store(false, Ordering::Release);
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow_mut().take() {
            restore_layout(
                &surface.vbox,
                &surface.overlay,
                &surface.webview,
                surface.webview_position,
            );
            if surface.blocked_button_handlers {
                set_button_handlers_blocked(&surface.webview, false);
            }
        }
    });
    Ok(())
}

pub fn refresh() {
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow().as_ref() {
            surface.area.queue_render();
        }
    });
}

fn restore_layout(vbox: &gtk::Box, overlay: &Overlay, webview: &Widget, position: i32) {
    overlay.remove(webview);
    vbox.remove(overlay);
    vbox.pack_start(webview, true, true, 0);
    vbox.reorder_child(webview, position);
    webview.show();
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
        surface
            .render
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

fn set_button_handlers_blocked(webview: &Widget, blocked: bool) -> bool {
    unsafe {
        let signal = glib::gobject_ffi::g_signal_lookup(
            c"button-press-event".as_ptr(),
            webview.type_().into_glib(),
        );
        if signal == 0 {
            return false;
        }
        let widget_stash: Stash<'_, *mut gtk::ffi::GtkWidget, Widget> = webview.to_glib_none();
        let instance = widget_stash.0 as *mut glib::gobject_ffi::GObject;
        let matched = if blocked {
            glib::gobject_ffi::g_signal_handlers_block_matched(
                instance,
                glib::gobject_ffi::G_SIGNAL_MATCH_ID,
                signal,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } else {
            glib::gobject_ffi::g_signal_handlers_unblock_matched(
                instance,
                glib::gobject_ffi::G_SIGNAL_MATCH_ID,
                signal,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        matched > 0
    }
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
