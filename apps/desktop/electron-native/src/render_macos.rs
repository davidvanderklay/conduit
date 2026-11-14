// CAOpenGLLayer and CGL are deprecated, but they are still how libmpv's
// OpenGL render API reaches the screen on macOS.
#![allow(deprecated)]

use std::{
    ffi::{c_char, c_void, CString},
    ptr::{self, NonNull},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

use libmpv2::{
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Mpv,
};
use objc2::{define_class, msg_send, rc::Retained, runtime::NSObject, AnyThread, MainThreadOnly};
use objc2_app_kit::{NSView, NSWindowOrderingMode};
use objc2_core_foundation::{CFTimeInterval, CGFloat};
use objc2_core_graphics::{kCGColorSpaceExtendedLinearDisplayP3, CGColorSpace};
use objc2_core_video::CVTimeStamp;
use objc2_foundation::MainThreadMarker;
use objc2_open_gl::{
    CGLChoosePixelFormat, CGLContextObj, CGLCreateContext, CGLError, CGLPixelFormatAttribute,
    CGLPixelFormatObj, CGLReleaseContext, CGLReleasePixelFormat, CGLRetainContext,
    CGLRetainPixelFormat, CGLSetCurrentContext,
};
use objc2_quartz_core::{kCAContentsFormatRGBA16Float, CAAutoresizingMask, CALayer, CAOpenGLLayer};

const OPENGL_PROFILE: u32 = 99;
const PROFILE_3_2_CORE: u32 = 0x3200;
const ACCELERATED: u32 = 73;
const DOUBLEBUFFER: u32 = 5;
const COLOR_SIZE: u32 = 8;
const COLOR_FLOAT: u32 = 58;
const ALLOW_OFFLINE_RENDERERS: u32 = 96;
const RESIZE_WIDTH: usize = 2;
const RESIZE_HEIGHT: usize = 16;

/// mpv's linear output maps 1.0 to SDR reference white (203 nits), so the
/// screen's EDR headroom times this is the brightest value it can show.
const SDR_REFERENCE_WHITE_NITS: f64 = 203.0;

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dispatch_async_f(queue: *mut c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
    static _dispatch_main_q: c_void;
}

const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

define_class!(
    // SAFETY: CAOpenGLLayer has no subclassing requirements beyond matching
    // the overridden method signatures, and this class holds no state.
    #[unsafe(super(CAOpenGLLayer, CALayer, NSObject))]
    #[name = "ConduitVideoLayer"]
    struct VideoLayer;

    impl VideoLayer {
        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn can_draw(
            &self,
            _ctx: CGLContextObj,
            _pf: CGLPixelFormatObj,
            _t: CFTimeInterval,
            _ts: *const CVTimeStamp,
        ) -> bool {
            true
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn draw(
            &self,
            ctx: CGLContextObj,
            pf: CGLPixelFormatObj,
            t: CFTimeInterval,
            ts: *const CVTimeStamp,
        ) {
            if let Err(error) = render(self) {
                eprintln!("Conduit Electron: macOS libmpv render failed: {error}");
            }
            // The default implementation flushes the context.
            unsafe {
                let _: () = msg_send![
                    super(self),
                    drawInCGLContext: ctx,
                    pixelFormat: pf,
                    forLayerTime: t,
                    displayTime: ts
                ];
            }
        }

        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> CGLPixelFormatObj {
            surface_gl().map_or(ptr::null_mut(), |gl| unsafe { CGLRetainPixelFormat(gl.0) })
        }

        #[unsafe(method(copyCGLContextForPixelFormat:))]
        fn copy_context(&self, _pf: CGLPixelFormatObj) -> CGLContextObj {
            surface_gl().map_or(ptr::null_mut(), |gl| unsafe { CGLRetainContext(gl.1) })
        }
    }
);

/// The output state last handed to mpv and the layer: whether HDR is shown
/// as EDR, and the peak brightness mpv tone maps to.
#[derive(Clone, Copy, PartialEq)]
enum Output {
    Sdr,
    Edr { peak_nits: u32 },
}

struct EmbeddedSurface {
    view: Retained<NSView>,
    layer: Retained<VideoLayer>,
    pixel_format: CGLPixelFormatObj,
    context: CGLContextObj,
    /// Float surfaces can carry values above SDR white; 8-bit ones cannot.
    float: bool,
    output: Output,
    // The Player owns the Mpv for at least as long as this surface. See the
    // lifetime extension in install, which preserves that invariant across
    // the global surface registry.
    render: Mutex<RenderContext<'static>>,
}

unsafe impl Send for EmbeddedSurface {}

static SURFACE: OnceLock<Mutex<Option<EmbeddedSurface>>> = OnceLock::new();
static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);

fn surface() -> &'static Mutex<Option<EmbeddedSurface>> {
    SURFACE.get_or_init(|| Mutex::new(None))
}

fn surface_gl() -> Option<(CGLPixelFormatObj, CGLContextObj)> {
    let guard = surface().lock().ok()?;
    guard
        .as_ref()
        .map(|surface| (surface.pixel_format, surface.context))
}

/// Places a layer-hosting view below Electron's web contents and connects
/// mpv's OpenGL render API to it.
pub fn install(mpv: &Mpv, view_pointer: i64) -> Result<(), String> {
    let main_thread = MainThreadMarker::new().ok_or_else(|| {
        "Electron player installation must run on the macOS main thread".to_owned()
    })?;
    if view_pointer == 0 {
        return Err("Electron returned a null NSView pointer".into());
    }
    if let Some(previous) = surface().lock().map_err(|error| error.to_string())?.take() {
        teardown(previous);
    }

    let (pixel_format, float) = choose_pixel_format()?;
    let mut context: CGLContextObj = ptr::null_mut();
    let error =
        unsafe { CGLCreateContext(pixel_format, ptr::null_mut(), NonNull::from(&mut context)) };
    if error != CGLError::NoError || context.is_null() {
        unsafe { CGLReleasePixelFormat(pixel_format) };
        return Err(format!("OpenGL context creation failed ({})", error.0));
    }

    unsafe {
        // Electron's getNativeWindowHandle() returns the BrowserWindow content
        // NSView on macOS. Because this addon runs in Electron's browser
        // process, dereferencing and retaining the pointer is valid.
        let parent = &*(view_pointer as *const NSView);

        let layer: Retained<VideoLayer> = msg_send![VideoLayer::alloc(), init];
        layer.setAsynchronous(false);
        layer.setAutoresizingMask(
            CAAutoresizingMask::LayerWidthSizable | CAAutoresizingMask::LayerHeightSizable,
        );
        if float {
            layer.setContentsFormat(kCAContentsFormatRGBA16Float);
        }

        // Setting the layer before wantsLayer makes this a layer-hosting view,
        // so AppKit leaves drawing to the layer.
        let view = NSView::initWithFrame(NSView::alloc(main_thread), parent.bounds());
        view.setLayer(Some(&layer));
        view.setWantsLayer(true);
        if let Some(webview) = parent.subviews().firstObject() {
            parent.addSubview_positioned_relativeTo(
                &view,
                NSWindowOrderingMode::Below,
                Some(&webview),
            );
        } else {
            parent.addSubview(&view);
        }
        let _: () = msg_send![&*view, setAutoresizingMask: RESIZE_WIDTH | RESIZE_HEIGHT];
        layer.setFrame(view.bounds());
        layer.setContentsScale(backing_scale(&view));

        CGLSetCurrentContext(context);
        let parameters = vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams::<()> {
                get_proc_address,
                ctx: (),
            }),
        ];
        let render = match mpv.create_render_context(parameters) {
            Ok(render) => render,
            Err(error) => {
                view.removeFromSuperview();
                CGLSetCurrentContext(ptr::null_mut());
                CGLReleaseContext(context);
                CGLReleasePixelFormat(pixel_format);
                return Err(format!("libmpv render context: {error:?}"));
            }
        };
        let mut render = render;
        render.set_update_callback(schedule_redraw);
        // RenderContext borrows Mpv in the v6 API. The surface is global, but
        // Player::stop always removes it before dropping its Mpv, preserving
        // the borrow's actual lifetime.
        let render = std::mem::transmute::<RenderContext<'_>, RenderContext<'static>>(render);

        *surface().lock().map_err(|error| error.to_string())? = Some(EmbeddedSurface {
            view,
            layer,
            pixel_format,
            context,
            float,
            output: Output::Sdr,
            render: Mutex::new(render),
        });
    }
    schedule_redraw();
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    MainThreadMarker::new()
        .ok_or_else(|| "Electron player removal must run on the macOS main thread".to_owned())?;
    if let Some(surface) = surface().lock().map_err(|error| error.to_string())?.take() {
        teardown(surface);
    }
    Ok(())
}

pub fn refresh() -> Result<(), String> {
    MainThreadMarker::new()
        .ok_or_else(|| "Electron player refresh must run on the macOS main thread".to_owned())?;
    let layer = {
        let guard = surface().lock().map_err(|error| error.to_string())?;
        let Some(surface) = guard.as_ref() else {
            return Ok(());
        };
        surface.layer.setFrame(surface.view.bounds());
        surface.layer.setContentsScale(backing_scale(&surface.view));
        surface.layer.clone()
    };
    layer.display();
    Ok(())
}

/// Shows HDR video as EDR when the screen can go brighter than SDR white.
/// mpv tone maps to the screen's current headroom in extended linear Display
/// P3, so macOS composites it without tone mapping it again. Called from the
/// snapshot poll, which also catches a move to another screen and headroom
/// changes from the brightness setting.
pub fn sync_output(mpv: &Mpv) {
    if MainThreadMarker::new().is_none() {
        return;
    }
    let Ok(mut guard) = surface().lock() else {
        return;
    };
    let Some(surface) = guard.as_mut() else {
        return;
    };
    if !surface.float {
        return;
    }
    let gamma = mpv
        .get_property::<String>("video-params/gamma")
        .unwrap_or_default();
    let screen = surface.view.window().and_then(|window| window.screen());
    let (potential, headroom) = screen.map_or((1.0, 1.0), |screen| {
        (
            screen.maximumPotentialExtendedDynamicRangeColorComponentValue(),
            screen.maximumExtendedDynamicRangeColorComponentValue(),
        )
    });
    let output = if matches!(gamma.as_str(), "pq" | "hlg") && potential > 1.0 {
        Output::Edr {
            peak_nits: (headroom.max(1.0) * SDR_REFERENCE_WHITE_NITS).round() as u32,
        }
    } else {
        Output::Sdr
    };
    if output == surface.output {
        return;
    }
    surface.output = output;

    let colorspace = match output {
        Output::Edr { .. } => {
            CGColorSpace::with_name(Some(unsafe { kCGColorSpaceExtendedLinearDisplayP3 }))
        }
        Output::Sdr => None,
    };
    surface
        .layer
        .setWantsExtendedDynamicRangeContent(matches!(output, Output::Edr { .. }));
    surface.layer.setColorspace(colorspace.as_deref());
    let peak = match output {
        Output::Edr { peak_nits } => peak_nits.to_string(),
        Output::Sdr => "auto".to_owned(),
    };
    let (trc, primaries) = match output {
        Output::Edr { .. } => ("linear", "display-p3"),
        Output::Sdr => ("auto", "auto"),
    };
    for (name, value) in [
        ("target-trc", trc),
        ("target-prim", primaries),
        ("target-peak", peak.as_str()),
    ] {
        if let Err(error) = mpv.set_property(name, value) {
            eprintln!("Conduit Electron: could not set mpv {name}={value}: {error}");
        }
    }
}

fn choose_pixel_format() -> Result<(CGLPixelFormatObj, bool), String> {
    // A 16-bit float surface first, for EDR and to keep 10-bit video from
    // banding. Some GPUs refuse it, so an 8-bit surface is the fallback.
    let float = [
        OPENGL_PROFILE,
        PROFILE_3_2_CORE,
        ACCELERATED,
        DOUBLEBUFFER,
        COLOR_SIZE,
        64,
        COLOR_FLOAT,
        ALLOW_OFFLINE_RENDERERS,
        0,
    ];
    let standard = [
        OPENGL_PROFILE,
        PROFILE_3_2_CORE,
        ACCELERATED,
        DOUBLEBUFFER,
        COLOR_SIZE,
        24,
        ALLOW_OFFLINE_RENDERERS,
        0,
    ];
    for (attributes, is_float) in [(&float[..], true), (&standard[..], false)] {
        let mut attributes = attributes
            .iter()
            .map(|&value| CGLPixelFormatAttribute(value))
            .collect::<Vec<_>>();
        let mut pixel_format: CGLPixelFormatObj = ptr::null_mut();
        let mut count = 0;
        let error = unsafe {
            CGLChoosePixelFormat(
                NonNull::new(attributes.as_mut_ptr()).expect("attributes"),
                NonNull::from(&mut pixel_format),
                NonNull::from(&mut count),
            )
        };
        if error == CGLError::NoError && !pixel_format.is_null() {
            return Ok((pixel_format, is_float));
        }
    }
    Err("OpenGL pixel format creation failed".into())
}

fn backing_scale(view: &NSView) -> CGFloat {
    view.window()
        .map(|window| window.backingScaleFactor())
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0)
}

fn teardown(surface: EmbeddedSurface) {
    surface.view.removeFromSuperview();
    unsafe {
        // mpv frees its GL objects, so its context must be current.
        CGLSetCurrentContext(surface.context);
        drop(surface.render);
        CGLSetCurrentContext(ptr::null_mut());
        CGLReleaseContext(surface.context);
        CGLReleasePixelFormat(surface.pixel_format);
    }
}

fn schedule_redraw() {
    if REDRAW_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    extern "C" fn redraw(_: *mut c_void) {
        REDRAW_PENDING.store(false, Ordering::Release);
        // display() draws synchronously and the draw callback takes the
        // surface lock, so release it first.
        let layer = surface()
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|surface| surface.layer.clone()));
        if let Some(layer) = layer {
            layer.display();
        }
    }
    unsafe {
        dispatch_async_f(
            (&raw const _dispatch_main_q).cast_mut(),
            std::ptr::null_mut(),
            redraw,
        );
    }
}

/// Renders the current frame into the layer's context, which Core Animation
/// has made current.
fn render(layer: &VideoLayer) -> Result<(), String> {
    let guard = surface().lock().map_err(|error| error.to_string())?;
    let Some(surface) = guard.as_ref() else {
        return Ok(());
    };
    let bounds = layer.bounds();
    let scale = layer.contentsScale();
    let render = surface.render.lock().map_err(|error| error.to_string())?;
    render
        .render::<()>(
            0,
            (bounds.size.width * scale).max(1.0) as i32,
            (bounds.size.height * scale).max(1.0) as i32,
            true,
        )
        .map_err(|error| format!("libmpv render: {error:?}"))
}

fn get_proc_address(_: &(), name: &str) -> *mut c_void {
    CString::new(name)
        .map(|name| unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) })
        .unwrap_or(std::ptr::null_mut())
}
