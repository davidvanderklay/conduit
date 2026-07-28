// The Cocoa/libmpv rendering structure is adapted from Harbor's MIT-licensed
// Tauri player implementation: https://github.com/harborstremio/harbor
#![cfg(target_os = "macos")]
#![allow(deprecated)]

use std::{
    ffi::{c_char, c_void, CString},
    ptr::NonNull,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2_sys::mpv_handle;
use objc2::{msg_send, rc::Retained, AnyThread, ClassType, MainThreadOnly, Message};
use objc2_app_kit::{NSOpenGLPixelFormat, NSOpenGLView, NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{MainThreadMarker, NSNumber, NSString};

const OPENGL_PROFILE: u32 = 99;
const PROFILE_3_2_CORE: u32 = 0x3200;
const DOUBLEBUFFER: u32 = 5;
const ACCELERATED: u32 = 73;
const NO_RECOVERY: u32 = 72;
const COLOR_SIZE: u32 = 8;
const DEPTH_SIZE: u32 = 12;
const RESIZE_WIDTH: usize = 2;
const RESIZE_HEIGHT: usize = 16;

extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dispatch_async_f(queue: *mut c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
    static _dispatch_main_q: c_void;
}

const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

struct EmbeddedSurface {
    view: Retained<NSOpenGLView>,
    webview: Option<Retained<NSView>>,
    window: Retained<NSWindow>,
    render: Mutex<RenderContext>,
}

unsafe impl Send for EmbeddedSurface {}

static SURFACE: OnceLock<Mutex<Option<EmbeddedSurface>>> = OnceLock::new();
static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);

fn surface() -> &'static Mutex<Option<EmbeddedSurface>> {
    SURFACE.get_or_init(|| Mutex::new(None))
}

pub fn install(context: NonNull<mpv_handle>, window_pointer: i64) -> Result<(), String> {
    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| "surface installation must run on main thread".to_owned())?;
    if window_pointer == 0 {
        return Err("native window pointer was null".into());
    }
    if let Some(previous) = surface().lock().map_err(|error| error.to_string())?.take() {
        teardown(previous);
    }

    unsafe {
        let window = &*(window_pointer as *const NSWindow);
        let content = window
            .contentView()
            .ok_or_else(|| "native window has no content view".to_owned())?;
        let bounds = content.bounds();
        let attributes = [
            OPENGL_PROFILE,
            PROFILE_3_2_CORE,
            DOUBLEBUFFER,
            1,
            ACCELERATED,
            1,
            NO_RECOVERY,
            1,
            COLOR_SIZE,
            24,
            DEPTH_SIZE,
            16,
            0,
        ];
        let format: Option<Retained<NSOpenGLPixelFormat>> =
            msg_send![NSOpenGLPixelFormat::alloc(), initWithAttributes: attributes.as_ptr()];
        let format = format.ok_or_else(|| "OpenGL pixel format creation failed".to_owned())?;
        let view: Option<Retained<NSOpenGLView>> = msg_send![
            NSOpenGLView::alloc(main_thread),
            initWithFrame: bounds,
            pixelFormat: &*format
        ];
        let view = view.ok_or_else(|| "OpenGL view creation failed".to_owned())?;
        let view_base: &NSView = view.as_super();
        let webview = content.subviews().firstObject();
        if let Some(reference) = webview.as_deref() {
            content.addSubview_positioned_relativeTo(
                view_base,
                NSWindowOrderingMode::Below,
                Some(reference),
            );
        } else {
            content.addSubview(view_base);
        }
        let _: () = msg_send![view_base, setAutoresizingMask: RESIZE_WIDTH | RESIZE_HEIGHT];
        let _: () = msg_send![view_base, setWantsBestResolutionOpenGLSurface: true];

        if let Some(webview) = webview.as_deref() {
            let false_value = NSNumber::new_bool(false);
            let draws_background = NSString::from_str("drawsBackground");
            let _: () = msg_send![webview, setValue: &*false_value, forKey: &*draws_background];
            let _: () = msg_send![webview, setWantsLayer: true];
            if let Some(layer) = webview.layer() {
                let _: () = msg_send![&*layer, setOpaque: false];
            }
        }

        let gl = view
            .openGLContext()
            .ok_or_else(|| "OpenGL context creation failed".to_owned())?;
        gl.makeCurrentContext();
        let parameters = vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams::<()> {
                get_proc_address,
                ctx: (),
            }),
        ];
        let mut render = RenderContext::new(&mut *context.as_ptr(), parameters)
            .map_err(|error| format!("libmpv render context: {error:?}"))?;
        render.set_update_callback(schedule_redraw);

        *surface().lock().map_err(|error| error.to_string())? = Some(EmbeddedSurface {
            view,
            webview,
            window: window.retain(),
            render: Mutex::new(render),
        });
    }
    schedule_redraw();
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    MainThreadMarker::new().ok_or_else(|| "surface removal must run on main thread".to_owned())?;
    if let Some(surface) = surface().lock().map_err(|error| error.to_string())?.take() {
        teardown(surface);
    }
    Ok(())
}

fn teardown(surface: EmbeddedSurface) {
    unsafe {
        let view: &NSView = surface.view.as_super();
        view.removeFromSuperview();
        if let Some(webview) = surface.webview.as_deref() {
            let true_value = NSNumber::new_bool(true);
            let draws_background = NSString::from_str("drawsBackground");
            let _: () = msg_send![webview, setValue: &*true_value, forKey: &*draws_background];
        }
    }
    drop(surface.window);
}

fn schedule_redraw() {
    if REDRAW_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    extern "C" fn redraw(_: *mut c_void) {
        REDRAW_PENDING.store(false, Ordering::Release);
        let _ = render();
    }
    unsafe {
        dispatch_async_f(
            (&_dispatch_main_q as *const c_void).cast_mut(),
            std::ptr::null_mut(),
            redraw,
        );
    }
}

fn render() -> Result<(), String> {
    MainThreadMarker::new().ok_or_else(|| "render must run on main thread".to_owned())?;
    let guard = surface().lock().map_err(|error| error.to_string())?;
    let Some(surface) = guard.as_ref() else {
        return Ok(());
    };
    let gl = surface
        .view
        .openGLContext()
        .ok_or_else(|| "OpenGL context disappeared".to_owned())?;
    gl.makeCurrentContext();
    let view: &NSView = surface.view.as_super();
    let backing = view.convertRectToBacking(view.bounds());
    let width = backing.size.width.max(1.0) as i32;
    let height = backing.size.height.max(1.0) as i32;
    surface
        .render
        .lock()
        .map_err(|error| error.to_string())?
        .render::<()>(0, width, height, true)
        .map_err(|error| format!("libmpv render: {error:?}"))?;
    gl.flushBuffer();
    Ok(())
}

fn get_proc_address(_: &(), name: &str) -> *mut c_void {
    CString::new(name)
        .map(|name| unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) })
        .unwrap_or(std::ptr::null_mut())
}
