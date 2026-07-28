#![cfg(target_os = "linux")]

use gtk::{
    glib,
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

struct EmbeddedSurface {
    area: GLArea,
    overlay: Overlay,
    webview: Widget,
    vbox: gtk::Box,
    webview_position: i32,
    render: RenderContext,
}

thread_local! {
    static SURFACE: RefCell<Option<EmbeddedSurface>> = const { RefCell::new(None) };
}

static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
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
        return Err(format!("OpenGL context creation failed: {error}"));
    }

    let parameters = vec![
        RenderParam::ApiType(RenderParamApiType::OpenGl),
        RenderParam::InitParams(OpenGLInitParams::<()> {
            get_proc_address,
            ctx: (),
        }),
    ];
    let mut render = match RenderContext::new(unsafe { &mut *context.as_ptr() }, parameters) {
        Ok(render) => render,
        Err(error) => {
            restore_layout(&vbox, &overlay, &webview, webview_position);
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
        if let Some(error) = surface.area.error() {
            return Err(format!("OpenGL context failed: {error}"));
        }
        let scale = surface.area.scale_factor().max(1);
        let width = (surface.area.allocated_width() * scale).max(1);
        let height = (surface.area.allocated_height() * scale).max(1);
        surface
            .render
            .render::<()>(0, width, height, true)
            .map_err(|error| format!("libmpv render: {error:?}"))
    })
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
