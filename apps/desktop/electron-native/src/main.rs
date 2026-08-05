use libmpv2::{mpv_node::MpvNode, Mpv};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::CString,
    io::{self, BufRead, Write},
};
use thiserror::Error;

#[derive(Debug, Error)]
enum NativeError {
    #[error("embedded libmpv could not be initialized: {0}")]
    Initialization(String),
    #[error("mpv is not running")]
    NotRunning,
    #[error("invalid media URL")]
    InvalidUrl,
    #[error("invalid native window id: {0}")]
    InvalidWindowId(String),
    #[error("mpv command failed: {0}")]
    Command(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Success {
    id: u64,
    result: Value,
}

#[derive(Debug, Serialize)]
struct Failure {
    id: u64,
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenParams {
    url: String,
    title: String,
    read_ahead_seconds: u32,
    hardware_acceleration: bool,
    window_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayRegion {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PlayerTrack {
    id: i64,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    lang: Option<String>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    selected: bool,
    #[serde(default)]
    external: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PlayerSnapshot {
    running: bool,
    ended: bool,
    paused: bool,
    loading: bool,
    position: f64,
    duration: f64,
    buffered_duration: f64,
    volume: f64,
    title: Option<String>,
    tracks: Vec<PlayerTrack>,
    playback_path: PlaybackPath,
    container: Option<String>,
    video_codec: Option<String>,
    audio_codec: Option<String>,
    hardware_decoder: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Default)]
#[serde(rename_all = "camelCase")]
enum PlaybackPath {
    #[default]
    DirectPlay,
}

#[cfg(target_os = "linux")]
struct VideoHost {
    display: *mut x11::xlib::Display,
    window: u64,
    container: u64,
}

#[cfg(target_os = "linux")]
impl Drop for VideoHost {
    fn drop(&mut self) {
        unsafe {
            if self.display.is_null() {
                return;
            }
            x11::xlib::XDestroyWindow(self.display, self.window as x11::xlib::Window);
            x11::xlib::XFlush(self.display);
            x11::xlib::XCloseDisplay(self.display);
        }
    }
}

#[derive(Default)]
struct Player {
    mpv: Option<Mpv>,
    parent_window: Option<u64>,
    #[cfg(target_os = "linux")]
    host_window: Option<VideoHost>,
}

impl Player {
    fn open(&mut self, params: OpenParams) -> Result<PlayerSnapshot, NativeError> {
        if !valid_media_url(&params.url) {
            return Err(NativeError::InvalidUrl);
        }
        let window_id = params
            .window_id
            .parse::<i64>()
            .map_err(|error| NativeError::InvalidWindowId(error.to_string()))?;
        if window_id <= 0 {
            return Err(NativeError::InvalidWindowId(params.window_id));
        }
        let parent_window = window_id as u64;

        self.stop();
        force_c_numeric_locale();
        let host_window = create_video_host_window(parent_window)?;

        let nvidia_driver = std::path::Path::new("/proc/driver/nvidia/version").exists();
        let hwdec_override = std::env::var("CONDUIT_MPV_HWDEC").ok();
        let vaapi_device = linux_vaapi_device();
        let mpv_debug_logging = std::env::var_os("CONDUIT_MPV_LOG").is_some();

        let mpv = match Mpv::with_initializer(|initializer| {
            // libmpv owns a child window inside a separate X11 host window.
            // The host sits above Electron and its shape leaves the controls
            // exposed in the Chromium window below it.
            initializer.set_option("vo", "gpu-next")?;
            initializer.set_option("gpu-api", "opengl")?;
            initializer.set_option("gpu-context", "x11egl")?;
            initializer.set_option("wid", host_window.window as i64)?;
            initializer.set_option("force-window", "immediate")?;
            // stdout is the native helper's JSON IPC channel. Keep mpv's
            // terminal output disabled even in diagnostic mode so log lines
            // cannot corrupt responses sent back to Electron.
            initializer.set_option("terminal", "no")?;
            initializer.set_option("input-default-bindings", "no")?;
            initializer.set_option("input-cursor", "no")?;
            initializer.set_option("osd-level", "0")?;
            if mpv_debug_logging {
                initializer.set_option(
                    "msg-level",
                    "all=warn,vd=trace,vaapi=trace,ffmpeg=trace,vo=debug",
                )?;
                eprintln!("Conduit Electron: enabled mpv hardware-decoder diagnostics");
            }
            if is_network_media_url(&params.url) {
                for (name, value) in network_buffer_options(params.read_ahead_seconds) {
                    initializer.set_option(name, value)?;
                }
            }
            if params.hardware_acceleration {
                let hwdec = hwdec_override
                    .as_deref()
                    .unwrap_or_else(|| linux_hwdec_order(nvidia_driver));
                initializer.set_option("hwdec", hwdec)?;
                if let Some(device) = vaapi_device.as_deref() {
                    initializer.set_option("vaapi-device", device)?;
                    eprintln!("Conduit Electron: using VA-API DRM device {device}");
                }
                if hwdec_override.is_some() {
                    eprintln!("Conduit Electron: overriding mpv hardware decoder with {hwdec}");
                }
                if nvidia_driver {
                    initializer.set_option("gpu-hwdec-interop", "no")?;
                    initializer.set_option("vd-lavc-dr", "no")?;
                }
            } else {
                initializer.set_option("hwdec", "no")?;
            }
            initializer.set_option("audio-channels", "auto-safe")?;
            initializer.set_option("video-timing-offset", "0")?;
            Ok(())
        })
        .map_err(|error| NativeError::Initialization(error.to_string()))
        {
            Ok(mpv) => mpv,
            Err(error) => {
                drop(host_window);
                return Err(error);
            }
        };

        if let Err(error) = mpv
            .set_property("force-media-title", params.title.as_str())
            .map_err(|error| NativeError::Command(error.to_string()))
            .and_then(|()| argv_command(&mpv, &["loadfile", params.url.as_str(), "replace"]))
        {
            drop(mpv);
            drop(host_window);
            return Err(error);
        }

        self.parent_window = Some(parent_window);
        self.host_window = Some(host_window);
        self.mpv = Some(mpv);
        sync_video_host_window(
            parent_window,
            self.host_window.as_mut().expect("host window"),
        )?;
        self.snapshot()
    }

    fn stop(&mut self) {
        self.mpv.take();
        self.host_window.take();
        self.parent_window = None;
    }

    fn refresh_surface(&mut self) -> Result<(), NativeError> {
        if let (Some(parent_window), Some(host_window)) =
            (self.parent_window, self.host_window.as_mut())
        {
            sync_video_host_window(parent_window, host_window)?;
        }
        Ok(())
    }

    fn set_overlay_regions(&mut self, regions: Vec<OverlayRegion>) -> Result<(), NativeError> {
        let host_window = self.host_window.as_ref().ok_or(NativeError::NotRunning)?;
        set_video_host_shape(host_window, &regions)
    }

    fn command(&self, command: Vec<Value>) -> Result<Value, NativeError> {
        let mpv = self.mpv.as_ref().ok_or(NativeError::NotRunning)?;
        let args = command.iter().map(value_to_arg).collect::<Vec<_>>();
        if args.is_empty() {
            return Err(NativeError::Command("empty command".into()));
        }
        let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        argv_command(mpv, &refs)?;
        Ok(Value::Null)
    }

    fn snapshot(&self) -> Result<PlayerSnapshot, NativeError> {
        let mpv = self.mpv.as_ref().ok_or(NativeError::NotRunning)?;
        let tracks = mpv
            .get_property::<MpvNode>("track-list")
            .ok()
            .map(mpv_node_to_json)
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        Ok(PlayerSnapshot {
            running: true,
            ended: mpv.get_property::<bool>("eof-reached").unwrap_or(false),
            paused: mpv.get_property::<bool>("pause").unwrap_or(false),
            loading: mpv
                .get_property::<bool>("paused-for-cache")
                .unwrap_or(false),
            position: mpv.get_property::<f64>("time-pos").unwrap_or_default(),
            duration: mpv.get_property::<f64>("duration").unwrap_or_default(),
            buffered_duration: mpv
                .get_property::<f64>("demuxer-cache-duration")
                .unwrap_or_default()
                .max(0.0),
            volume: mpv.get_property::<f64>("volume").unwrap_or(100.0),
            title: mpv.get_property::<String>("media-title").ok(),
            tracks,
            playback_path: PlaybackPath::DirectPlay,
            container: non_empty_property(mpv, "file-format"),
            video_codec: non_empty_property(mpv, "video-format"),
            audio_codec: non_empty_property(mpv, "audio-codec-name"),
            hardware_decoder: non_empty_property(mpv, "hwdec-current")
                .filter(|decoder| decoder != "no"),
        })
    }
}

fn handle_request(player: &mut Player, request: Request) -> Result<Value, NativeError> {
    match request.method.as_str() {
        "player_open" => {
            let params: OpenParams = serde_json::from_value(request.params)
                .map_err(|error| NativeError::Command(error.to_string()))?;
            serde_json::to_value(player.open(params)?)
                .map_err(|error| NativeError::Command(error.to_string()))
        }
        "player_snapshot" => Ok(serde_json::to_value(player.snapshot()?)
            .map_err(|error| NativeError::Command(error.to_string()))?),
        "player_command" => {
            let command = request
                .params
                .get("command")
                .cloned()
                .ok_or_else(|| NativeError::Command("missing command".into()))?;
            let command = serde_json::from_value::<Vec<Value>>(command)
                .map_err(|error| NativeError::Command(error.to_string()))?;
            player.command(command)
        }
        "player_stop" => {
            player.stop();
            Ok(Value::Null)
        }
        "player_refresh_surface" | "player_redraw_surface" => {
            player.refresh_surface()?;
            Ok(Value::Null)
        }
        "player_set_overlay_regions" => {
            let regions = request
                .params
                .get("regions")
                .cloned()
                .ok_or_else(|| NativeError::Command("missing overlay regions".into()))?;
            let regions = serde_json::from_value::<Vec<OverlayRegion>>(regions)
                .map_err(|error| NativeError::Command(error.to_string()))?;
            player.set_overlay_regions(regions).map(|()| Value::Null)
        }
        _ => Err(NativeError::Command(format!(
            "unknown method {}",
            request.method
        ))),
    }
}

fn main() {
    #[cfg(not(target_os = "linux"))]
    {
        eprintln!("Conduit Electron native player currently supports Linux X11 only");
        std::process::exit(2);
    }

    let stdin = io::stdin();
    let mut player = Player::default();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) if !line.trim().is_empty() => line,
            Ok(_) => continue,
            Err(error) => {
                eprintln!("Conduit Electron native player stdin failed: {error}");
                break;
            }
        };
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("Conduit Electron native player request failed: {error}");
                continue;
            }
        };
        let id = request.id;
        let response = match handle_request(&mut player, request) {
            Ok(result) => serde_json::to_string(&Success { id, result }),
            Err(error) => serde_json::to_string(&Failure {
                id,
                error: error.to_string(),
            }),
        };
        match response {
            Ok(response) => {
                println!("{response}");
                let _ = io::stdout().flush();
            }
            Err(error) => eprintln!("Conduit Electron native player response failed: {error}"),
        }
    }
}

fn non_empty_property(mpv: &Mpv, name: &str) -> Option<String> {
    mpv.get_property::<String>(name)
        .ok()
        .filter(|value| !value.is_empty())
}

fn network_buffer_options(read_ahead_seconds: u32) -> Vec<(&'static str, String)> {
    let seconds = read_ahead_seconds.clamp(10, 120);
    vec![
        ("cache", "yes".into()),
        ("cache-on-disk", "no".into()),
        ("cache-secs", seconds.to_string()),
        ("demuxer-readahead-secs", seconds.to_string()),
        ("demuxer-max-bytes", "150MiB".into()),
        ("demuxer-max-back-bytes", "75MiB".into()),
        ("cache-pause", "yes".into()),
        ("cache-pause-initial", "yes".into()),
        ("cache-pause-wait", seconds.min(3).to_string()),
        ("network-timeout", "30".into()),
        (
            "stream-lavf-o",
            "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5".into(),
        ),
    ]
}

fn argv_command(mpv: &Mpv, args: &[&str]) -> Result<(), NativeError> {
    let strings = args
        .iter()
        .map(|arg| CString::new(*arg))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| NativeError::Command(error.to_string()))?;
    let mut pointers = strings
        .iter()
        .map(|arg| arg.as_ptr())
        .chain(std::iter::once(std::ptr::null()))
        .collect::<Vec<_>>();
    let result = unsafe { libmpv2_sys::mpv_command(mpv.ctx.as_ptr(), pointers.as_mut_ptr()) };
    if result < 0 {
        Err(NativeError::Command(format!("mpv error {result}")))
    } else {
        Ok(())
    }
}

fn value_to_arg(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Bool(value) => {
            if *value {
                "yes".into()
            } else {
                "no".into()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::Null => String::new(),
        value => value.to_string(),
    }
}

fn valid_media_url(url: &str) -> bool {
    matches!(url.split(':').next(), Some("http" | "https" | "file"))
}

fn is_network_media_url(url: &str) -> bool {
    matches!(url.split(':').next(), Some("http" | "https"))
}

fn mpv_node_to_json(node: MpvNode) -> Value {
    match node {
        MpvNode::None => Value::Null,
        MpvNode::String(value) => Value::String(value),
        MpvNode::Flag(value) => Value::Bool(value),
        MpvNode::Int64(value) => json!(value),
        MpvNode::Double(value) => json!(value),
        MpvNode::ArrayIter(values) => Value::Array(values.map(mpv_node_to_json).collect()),
        MpvNode::MapIter(values) => Value::Object(
            values
                .map(|(key, value)| (key, mpv_node_to_json(value)))
                .collect(),
        ),
    }
}

#[cfg(target_os = "linux")]
fn create_video_host_window(parent: u64) -> Result<VideoHost, NativeError> {
    use std::ptr;
    use x11::xlib::{
        CWOverrideRedirect, Window, XChangeWindowAttributes, XCloseDisplay, XCreateSimpleWindow,
        XFlush, XGetGeometry, XMapWindow, XOpenDisplay, XSetWindowAttributes,
    };

    unsafe {
        let display = XOpenDisplay(ptr::null());
        if display.is_null() {
            return Err(NativeError::Initialization(
                "could not open the X11 display for the video host".into(),
            ));
        }

        let mut root: Window = 0;
        let mut x = 0;
        let mut y = 0;
        let mut width = 0;
        let mut height = 0;
        let mut border = 0;
        let mut depth = 0;
        if XGetGeometry(
            display,
            parent as Window,
            &mut root,
            &mut x,
            &mut y,
            &mut width,
            &mut height,
            &mut border,
            &mut depth,
        ) == 0
        {
            XCloseDisplay(display);
            return Err(NativeError::InvalidWindowId(parent.to_string()));
        }

        let container = window_frame(display, parent as Window);
        let host = XCreateSimpleWindow(
            display,
            container,
            x,
            y,
            width.max(1),
            height.max(1),
            0,
            0,
            0,
        );
        if host == 0 {
            XCloseDisplay(display);
            return Err(NativeError::Initialization(
                "could not create the X11 video host window".into(),
            ));
        }

        let mut attributes: XSetWindowAttributes = std::mem::zeroed();
        attributes.override_redirect = 1;
        XChangeWindowAttributes(display, host, CWOverrideRedirect, &mut attributes);
        XMapWindow(display, host);
        restack_video_host(display, host, parent as Window);
        XFlush(display);
        if std::env::var_os("CONDUIT_MPV_LOG").is_some() {
            eprintln!("Conduit Electron: created X11 video host {host:#x} for parent {parent:#x}");
        }
        Ok(VideoHost {
            display,
            window: host as u64,
            container: container as u64,
        })
    }
}

#[cfg(target_os = "linux")]
fn sync_video_host_window(parent: u64, host: &mut VideoHost) -> Result<(), NativeError> {
    use x11::xlib::{Window, XFlush, XGetGeometry, XMoveResizeWindow, XReparentWindow};

    unsafe {
        let mut root: Window = 0;
        let mut x = 0;
        let mut y = 0;
        let mut width = 0;
        let mut height = 0;
        let mut border = 0;
        let mut depth = 0;
        let result = XGetGeometry(
            host.display,
            parent as Window,
            &mut root,
            &mut x,
            &mut y,
            &mut width,
            &mut height,
            &mut border,
            &mut depth,
        );
        if result == 0 {
            return Err(NativeError::InvalidWindowId(parent.to_string()));
        }

        let container = window_frame(host.display, parent as Window);
        if host.container != container as u64 {
            XReparentWindow(host.display, host.window as Window, container, x, y);
            host.container = container as u64;
        }

        XMoveResizeWindow(
            host.display,
            host.window as Window,
            x,
            y,
            width.max(1),
            height.max(1),
        );
        restack_video_host(host.display, host.window as Window, parent as Window);
        XFlush(host.display);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn restack_video_host(
    display: *mut x11::xlib::Display,
    host: x11::xlib::Window,
    parent: x11::xlib::Window,
) {
    use x11::xlib::{
        Above, CWSibling, CWStackMode, XConfigureWindow, XRaiseWindow, XWindowChanges,
    };

    unsafe {
        // Keep native video above Chromium. The X11 bounding/input shape
        // applied to the host leaves the control rectangles exposed.
        let mut changes = XWindowChanges {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            border_width: 0,
            sibling: parent,
            stack_mode: Above,
        };
        XConfigureWindow(
            display,
            host,
            (CWSibling | CWStackMode) as u32,
            &mut changes,
        );
        XRaiseWindow(display, host);
    }
}

#[cfg(target_os = "linux")]
fn window_frame(display: *mut x11::xlib::Display, window: x11::xlib::Window) -> x11::xlib::Window {
    use std::ptr;
    use x11::xlib::{Window, XFree, XQueryTree};

    unsafe {
        let mut root: Window = 0;
        let mut parent: Window = 0;
        let mut children: *mut Window = ptr::null_mut();
        let mut child_count = 0;
        let result = XQueryTree(
            display,
            window,
            &mut root,
            &mut parent,
            &mut children,
            &mut child_count,
        );
        if !children.is_null() {
            XFree(children.cast());
        }
        if result != 0 && parent != 0 {
            parent
        } else {
            window
        }
    }
}

#[cfg(target_os = "linux")]
fn set_video_host_shape(
    host: &VideoHost,
    overlay_regions: &[OverlayRegion],
) -> Result<(), NativeError> {
    use x11::{
        xfixes::{XFixesCreateRegion, XFixesDestroyRegion, XFixesSetWindowShapeRegion},
        xlib::{XFlush, XFree, XGetGeometry, XQueryTree, XRectangle},
    };

    const SHAPE_BOUNDING: libc::c_int = 0;
    const SHAPE_INPUT: libc::c_int = 2;

    unsafe {
        let mut root = 0;
        let mut x = 0;
        let mut y = 0;
        let mut width = 0;
        let mut height = 0;
        let mut border = 0;
        let mut depth = 0;
        if XGetGeometry(
            host.display,
            host.window as x11::xlib::Window,
            &mut root,
            &mut x,
            &mut y,
            &mut width,
            &mut height,
            &mut border,
            &mut depth,
        ) == 0
        {
            return Err(NativeError::InvalidWindowId(host.window.to_string()));
        }

        let mut full = XRectangle {
            x: 0,
            y: 0,
            width: width.min(u32::from(u16::MAX)) as u16,
            height: height.min(u32::from(u16::MAX)) as u16,
        };
        let video_region = XFixesCreateRegion(host.display, &mut full, 1);
        if video_region == 0 {
            return Err(NativeError::Initialization(
                "XFixes could not create the native video shape".into(),
            ));
        }

        let host_width = i64::from(width);
        let host_height = i64::from(height);
        for overlay in overlay_regions {
            let x0 = i64::from(overlay.x).clamp(0, host_width);
            let y0 = i64::from(overlay.y).clamp(0, host_height);
            let x1 = (i64::from(overlay.x) + i64::from(overlay.width)).clamp(x0, host_width);
            let y1 = (i64::from(overlay.y) + i64::from(overlay.height)).clamp(y0, host_height);
            if x1 <= x0 || y1 <= y0 {
                continue;
            }

            let mut overlay_rectangle = XRectangle {
                x: x0 as i16,
                y: y0 as i16,
                width: (x1 - x0) as u16,
                height: (y1 - y0) as u16,
            };
            let overlay_region = XFixesCreateRegion(host.display, &mut overlay_rectangle, 1);
            if overlay_region == 0 {
                XFixesDestroyRegion(host.display, video_region);
                return Err(NativeError::Initialization(
                    "XFixes could not create an overlay shape".into(),
                ));
            }
            x11::xfixes::XFixesSubtractRegion(
                host.display,
                video_region,
                video_region,
                overlay_region,
            );
            XFixesDestroyRegion(host.display, overlay_region);
        }

        let empty_input_region = XFixesCreateRegion(host.display, std::ptr::null_mut(), 0);
        if empty_input_region == 0 {
            XFixesDestroyRegion(host.display, video_region);
            return Err(NativeError::Initialization(
                "XFixes could not create the native input shape".into(),
            ));
        }

        let apply_shape = |window: x11::xlib::Window| {
            XFixesSetWindowShapeRegion(host.display, window, SHAPE_BOUNDING, 0, 0, video_region);
            XFixesSetWindowShapeRegion(host.display, window, SHAPE_INPUT, 0, 0, empty_input_region);
        };
        apply_shape(host.window as x11::xlib::Window);

        // libmpv creates its own child window inside the host. Shape that
        // child too because some X11 compositors composite child surfaces
        // independently of the parent's bounding shape.
        let mut child_root = 0;
        let mut child_parent = 0;
        let mut children = std::ptr::null_mut();
        let mut child_count = 0;
        if XQueryTree(
            host.display,
            host.window as x11::xlib::Window,
            &mut child_root,
            &mut child_parent,
            &mut children,
            &mut child_count,
        ) != 0
        {
            for index in 0..child_count as isize {
                apply_shape(*children.offset(index));
            }
        }
        if !children.is_null() {
            XFree(children.cast());
        }
        XFixesDestroyRegion(host.display, video_region);
        XFixesDestroyRegion(host.display, empty_input_region);
        XFlush(host.display);
        Ok(())
    }
}

#[cfg(unix)]
fn force_c_numeric_locale() {
    unsafe {
        libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
    }
}

#[cfg(target_os = "linux")]
fn linux_hwdec_order(nvidia_driver: bool) -> &'static str {
    if nvidia_driver {
        "nvdec-copy,vaapi-copy,vulkan-copy,drm-copy,auto-copy-safe"
    } else {
        "vaapi-copy,vulkan-copy,drm-copy,auto-copy-safe"
    }
}

#[cfg(target_os = "linux")]
fn linux_vaapi_device() -> Option<String> {
    let entries = std::fs::read_dir("/sys/class/drm").ok()?;
    let mut render_nodes = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("renderD"))
        .collect::<Vec<_>>();
    render_nodes.sort_by_key(|entry| entry.file_name());

    render_nodes.into_iter().find_map(|entry| {
        let vendor = std::fs::read_to_string(entry.path().join("device/vendor")).ok()?;
        if !matches!(vendor.trim(), "0x8086" | "0x1002") {
            return None;
        }
        let device = std::path::Path::new("/dev/dri").join(entry.file_name());
        device
            .exists()
            .then(|| device.to_string_lossy().into_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_supported_media_urls() {
        assert!(valid_media_url("https://example.test/video.mp4"));
        assert!(valid_media_url("file:///tmp/video.mp4"));
        assert!(!valid_media_url("javascript:alert(1)"));
    }

    #[test]
    fn bounds_network_read_ahead() {
        let options = network_buffer_options(500)
            .into_iter()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(options.get("cache-secs"), Some(&"120".to_string()));
        assert_eq!(
            options.get("demuxer-max-bytes"),
            Some(&"150MiB".to_string())
        );
    }

    #[test]
    fn converts_command_values_for_mpv() {
        assert_eq!(value_to_arg(&json!(true)), "yes");
        assert_eq!(value_to_arg(&json!(12.5)), "12.5");
    }
}
