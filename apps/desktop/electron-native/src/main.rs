use libmpv2::Mpv;
#[cfg(not(target_os = "linux"))]
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::CString;
#[cfg(target_os = "linux")]
use std::io::{BufRead, Write};
use thiserror::Error;

#[cfg(target_os = "macos")]
mod render_macos;

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
    #[serde(
        default,
        rename(deserialize = "demux-channels", serialize = "audioChannels")
    )]
    audio_channels: Option<String>,
    #[serde(default, rename(deserialize = "audio-channels"), skip_serializing)]
    decoded_channel_count: Option<Value>,
    #[serde(
        default,
        rename(deserialize = "demux-channel-count", serialize = "channelCount")
    )]
    channel_count: Option<u32>,
    #[serde(
        default,
        rename(deserialize = "demux-samplerate", serialize = "sampleRate")
    )]
    sample_rate: Option<u32>,
    #[serde(default, rename(deserialize = "demux-bitrate", serialize = "bitrate"))]
    bitrate: Option<u64>,
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
    first_frame_ready: bool,
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
    cursor: x11::xlib::Cursor,
    overlay_window: Option<x11::xlib::Window>,
    cursor_hidden: bool,
}

// The addon is invoked only from Electron's browser-thread event loop. This
// marker permits storage behind the process-global mutex without moving Xlib
// access onto worker threads.
#[cfg(target_os = "linux")]
unsafe impl Send for VideoHost {}

#[cfg(target_os = "macos")]
struct VideoHost;

#[cfg(target_os = "windows")]
struct VideoHost {
    window: u64,
}

#[cfg(target_os = "linux")]
impl Drop for VideoHost {
    fn drop(&mut self) {
        unsafe {
            if self.display.is_null() {
                return;
            }
            if self.cursor != 0 {
                x11::xlib::XFreeCursor(self.display, self.cursor);
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
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
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

        #[cfg(target_os = "linux")]
        let nvidia_driver = std::path::Path::new("/proc/driver/nvidia/version").exists();
        let hwdec_override = std::env::var("CONDUIT_MPV_HWDEC").ok();
        #[cfg(target_os = "linux")]
        let vaapi_device = linux_vaapi_device();
        let mpv_debug_logging = std::env::var_os("CONDUIT_MPV_LOG").is_some();

        let mpv = match Mpv::with_initializer(|initializer| {
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            initializer.set_option("vo", "gpu-next")?;
            #[cfg(target_os = "linux")]
            {
                // libmpv owns a child window inside the X11 host. Player chrome is
                // rendered by Electron's transparent top-level overlay window.
                initializer.set_option("gpu-api", "opengl")?;
                initializer.set_option("gpu-context", "x11egl")?;
            }
            #[cfg(target_os = "windows")]
            initializer.set_option("gpu-api", "d3d11")?;
            #[cfg(target_os = "macos")]
            {
                initializer.set_option("vo", "libmpv")?;
            }
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            initializer.set_option("wid", host_window.window as i64)?;
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            initializer.set_option("force-window", "immediate")?;
            #[cfg(target_os = "macos")]
            initializer.set_option("force-window", "no")?;
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
                #[cfg(target_os = "linux")]
                let hwdec = hwdec_override
                    .as_deref()
                    .unwrap_or_else(|| linux_hwdec_order(nvidia_driver));
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                let hwdec = hwdec_override.as_deref().unwrap_or("auto-safe");
                initializer.set_option("hwdec", hwdec)?;
                #[cfg(target_os = "linux")]
                if let Some(device) = vaapi_device.as_deref() {
                    initializer.set_option("vaapi-device", device)?;
                    eprintln!("Conduit Electron: using VA-API DRM device {device}");
                }
                if hwdec_override.is_some() {
                    eprintln!("Conduit Electron: overriding mpv hardware decoder with {hwdec}");
                }
                #[cfg(target_os = "linux")]
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

        #[cfg(target_os = "macos")]
        if let Err(error) = render_macos::install(&mpv, parent_window as i64) {
            drop(mpv);
            return Err(NativeError::Initialization(error));
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
        #[cfg(target_os = "macos")]
        let _ = render_macos::uninstall();
        self.mpv.take();
        self.host_window.take();
        self.parent_window = None;
    }

    fn refresh_surface(&mut self) -> Result<(), NativeError> {
        #[cfg(target_os = "macos")]
        render_macos::refresh().map_err(NativeError::Initialization)?;
        if let (Some(parent_window), Some(host_window)) =
            (self.parent_window, self.host_window.as_mut())
        {
            sync_video_host_window(parent_window, host_window)?;
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn set_overlay_window(&mut self, overlay_window: u64) -> Result<(), NativeError> {
        let parent_window = self.parent_window.ok_or(NativeError::NotRunning)?;
        attach_overlay_window(parent_window, overlay_window)?;
        let host_window = self.host_window.as_mut().ok_or(NativeError::NotRunning)?;
        host_window.overlay_window = Some(overlay_window as x11::xlib::Window);
        if host_window.cursor_hidden {
            define_hidden_cursor(host_window);
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn set_cursor_hidden(&mut self, hidden: bool) -> Result<(), NativeError> {
        let host_window = self.host_window.as_mut().ok_or(NativeError::NotRunning)?;
        if host_window.cursor_hidden == hidden {
            return Ok(());
        }
        host_window.cursor_hidden = hidden;
        if hidden {
            define_hidden_cursor(host_window);
        } else {
            define_inherited_cursor(host_window);
        }
        Ok(())
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

    fn snapshot(&mut self) -> Result<PlayerSnapshot, NativeError> {
        self.pump_events();
        let mpv = self.mpv.as_ref().ok_or(NativeError::NotRunning)?;
        let tracks = mpv
            .get_property::<String>("track-list")
            .ok()
            .map(|value| parse_track_list(&value))
            .unwrap_or_default();
        Ok(PlayerSnapshot {
            running: true,
            ended: mpv.get_property::<bool>("eof-reached").unwrap_or(false),
            paused: mpv.get_property::<bool>("pause").unwrap_or(false),
            loading: mpv
                .get_property::<bool>("paused-for-cache")
                .unwrap_or(false),
            first_frame_ready: has_video_frame(mpv),
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

    fn pump_events(&mut self) {
        let Some(mpv) = self.mpv.as_mut() else {
            return;
        };
        while let Some(event) = mpv.wait_event(0.0) {
            if let Err(error) = event {
                eprintln!("Conduit Electron native player mpv event failed: {error}");
            }
        }
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
        #[cfg(target_os = "linux")]
        "player_set_overlay_window" => {
            let window_id = request
                .params
                .get("windowId")
                .and_then(Value::as_str)
                .ok_or_else(|| NativeError::Command("missing overlay window id".into()))?
                .parse::<u64>()
                .map_err(|error| NativeError::InvalidWindowId(error.to_string()))?;
            player.set_overlay_window(window_id).map(|()| Value::Null)
        }
        #[cfg(target_os = "linux")]
        "player_set_cursor_hidden" => {
            let hidden = request
                .params
                .get("hidden")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            player.set_cursor_hidden(hidden).map(|()| Value::Null)
        }
        _ => Err(NativeError::Command(format!(
            "unknown method {}",
            request.method
        ))),
    }
}

#[cfg(not(target_os = "linux"))]
static PLAYER: std::sync::Mutex<Option<Player>> = std::sync::Mutex::new(None);

#[cfg(not(target_os = "linux"))]
#[napi]
pub fn invoke(request_json: String) -> napi::Result<String> {
    let request = serde_json::from_str::<Request>(&request_json)
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let id = request.id;
    let mut guard = PLAYER
        .lock()
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let player = guard.get_or_insert_with(Player::default);
    let response = match handle_request(player, request) {
        Ok(result) => Success { id, result },
        Err(error) => {
            return serde_json::to_string(&Failure {
                id,
                error: error.to_string(),
            })
            .map_err(|error| napi::Error::from_reason(error.to_string()));
        }
    };
    serde_json::to_string(&response).map_err(|error| napi::Error::from_reason(error.to_string()))
}

#[cfg(target_os = "linux")]
fn main() {
    // Linux uses an out-of-process helper to avoid Chromium's in-process GPU/sandbox conflicts.
    // The NAPI addon is required on macOS (NSView pointer cannot cross process boundary) but
    // causes mpv_initialize to abort inside Electron's browser process on Linux+Nvidia.
    let stdin = std::io::stdin();
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
                let _ = std::io::stdout().flush();
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

fn has_video_frame(mpv: &Mpv) -> bool {
    mpv.get_property::<String>("video-frame-info/picture-type")
        .map(|picture_type| !picture_type.is_empty())
        .unwrap_or(false)
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

fn parse_track_list(value: &str) -> Vec<PlayerTrack> {
    let mut tracks = serde_json::from_str::<Vec<PlayerTrack>>(value).unwrap_or_default();
    for track in &mut tracks {
        if track.channel_count.is_none() {
            track.channel_count = track
                .decoded_channel_count
                .as_ref()
                .and_then(decoded_channel_count);
        }
    }
    tracks
}

fn decoded_channel_count(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|count| u32::try_from(count).ok())
        .or_else(|| {
            let channels = value.as_str()?.trim().to_lowercase();
            match channels.as_str() {
                "mono" => Some(1),
                "stereo" => Some(2),
                _ => {
                    let layout = channels.split('(').next()?;
                    let (main, subwoofer) = layout.split_once('.')?;
                    main.parse::<u32>()
                        .ok()?
                        .checked_add(subwoofer.parse::<u32>().ok()?)
                }
            }
        })
}

#[cfg(target_os = "linux")]
fn attach_overlay_window(parent: u64, overlay: u64) -> Result<(), NativeError> {
    use std::ptr;
    use x11::xlib::{XCloseDisplay, XFlush, XOpenDisplay, XSetTransientForHint};

    unsafe {
        let display = XOpenDisplay(ptr::null());
        if display.is_null() {
            return Err(NativeError::Initialization(
                "could not open the X11 display for the player overlay".into(),
            ));
        }
        XSetTransientForHint(
            display,
            overlay as x11::xlib::Window,
            parent as x11::xlib::Window,
        );
        XFlush(display);
        XCloseDisplay(display);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn create_video_host_window(parent: u64) -> Result<VideoHost, NativeError> {
    use std::ptr;
    use x11::xlib::{
        CWOverrideRedirect, Window, XChangeWindowAttributes, XCloseDisplay, XCreateSimpleWindow,
        XDestroyWindow, XFlush, XGetGeometry, XMapWindow, XOpenDisplay, XSetWindowAttributes,
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

        // Put the native host in the same Mutter frame as Electron. This is
        // the X11 arrangement that lets libmpv's GL output render reliably,
        // while keeping the host attached to the application window.
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

        let cursor = match create_invisible_cursor(display, host) {
            Ok(cursor) => cursor,
            Err(error) => {
                XDestroyWindow(display, host);
                XCloseDisplay(display);
                return Err(error);
            }
        };

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
            cursor,
            overlay_window: None,
            cursor_hidden: false,
        })
    }
}

#[cfg(target_os = "linux")]
fn create_invisible_cursor(
    display: *mut x11::xlib::Display,
    window: x11::xlib::Window,
) -> Result<x11::xlib::Cursor, NativeError> {
    use std::os::raw::c_char;
    use x11::xlib::{XColor, XCreateBitmapFromData, XCreatePixmapCursor, XFreePixmap};

    unsafe {
        let bitmap_data = [0 as c_char];
        let source = XCreateBitmapFromData(display, window, bitmap_data.as_ptr(), 1, 1);
        let mask = XCreateBitmapFromData(display, window, bitmap_data.as_ptr(), 1, 1);
        if source == 0 || mask == 0 {
            if source != 0 {
                XFreePixmap(display, source);
            }
            if mask != 0 {
                XFreePixmap(display, mask);
            }
            return Err(NativeError::Initialization(
                "could not create the hidden X11 cursor".into(),
            ));
        }

        let mut color = XColor {
            pixel: 0,
            red: 0,
            green: 0,
            blue: 0,
            flags: 0,
            pad: 0,
        };
        let cursor = XCreatePixmapCursor(display, source, mask, &mut color, &mut color, 0, 0);
        XFreePixmap(display, source);
        XFreePixmap(display, mask);
        if cursor == 0 {
            return Err(NativeError::Initialization(
                "could not create the hidden X11 cursor".into(),
            ));
        }
        Ok(cursor)
    }
}

#[cfg(target_os = "linux")]
fn define_hidden_cursor(host: &VideoHost) {
    use x11::xlib::{XDefineCursor, XFlush};

    unsafe {
        XDefineCursor(host.display, host.window as x11::xlib::Window, host.cursor);
        if let Some(overlay_window) = host.overlay_window {
            XDefineCursor(host.display, overlay_window, host.cursor);
        }
        XFlush(host.display);
    }
}

#[cfg(target_os = "linux")]
fn define_inherited_cursor(host: &VideoHost) {
    use x11::xlib::{XFlush, XUndefineCursor};

    unsafe {
        XUndefineCursor(host.display, host.window as x11::xlib::Window);
        if let Some(overlay_window) = host.overlay_window {
            XUndefineCursor(host.display, overlay_window);
        }
        XFlush(host.display);
    }
}

#[cfg(target_os = "macos")]
fn create_video_host_window(parent: u64) -> Result<VideoHost, NativeError> {
    let _ = parent;
    Ok(VideoHost)
}

#[cfg(target_os = "windows")]
fn create_video_host_window(parent: u64) -> Result<VideoHost, NativeError> {
    Ok(VideoHost { window: parent })
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

#[cfg(target_os = "macos")]
fn sync_video_host_window(_parent: u64, _host: &mut VideoHost) -> Result<(), NativeError> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_video_host_window(parent: u64, _host: &mut VideoHost) -> Result<(), NativeError> {
    use windows::core::BOOL;
    use windows::Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::{
            EnumChildWindows, GetClassNameW, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOSIZE,
        },
    };

    struct Children {
        mpv: Vec<HWND>,
    }

    unsafe extern "system" fn collect(hwnd: HWND, state: LPARAM) -> BOOL {
        let mut class_name = [0_u16; 256];
        let length = unsafe { GetClassNameW(hwnd, &mut class_name) };
        let class_name = String::from_utf16_lossy(&class_name[..length as usize]);
        if class_name == "mpv" || class_name.starts_with("mpv ") {
            let state = unsafe { &mut *(state.0 as *mut Children) };
            state.mpv.push(hwnd);
        }
        BOOL(1)
    }

    let parent = HWND(parent as *mut core::ffi::c_void);
    let mut children = Children { mpv: Vec::new() };
    unsafe {
        let _ = EnumChildWindows(
            Some(parent),
            Some(collect),
            LPARAM((&mut children as *mut Children) as isize),
        );
        for hwnd in children.mpv {
            SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            )
            .map_err(|error| NativeError::Initialization(error.to_string()))?;
        }
    }
    Ok(())
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
        // formerly exposed controls in the Chromium window below it; the
        // Electron player now uses a separate transparent control window.
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

#[cfg(unix)]
fn force_c_numeric_locale() {
    unsafe {
        libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
    }
}

#[cfg(windows)]
fn force_c_numeric_locale() {}

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
    use serde_json::json;

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

    #[test]
    fn parses_mpv_track_list_json() {
        let tracks = parse_track_list(
            r#"[{"id":1,"type":"audio","title":"Main","codec":"ac3","audio-channels":6,"demux-channel-count":6,"demux-channels":"5.1(side)","demux-samplerate":48000,"demux-bitrate":640000,"selected":true},{"id":2,"type":"audio","audio-channels":2,"selected":false},{"id":3,"type":"audio","audio-channels":"stereo","selected":false}]"#,
        );

        assert_eq!(tracks.len(), 3);
        assert_eq!(tracks[0].id, 1);
        assert_eq!(tracks[0].kind, "audio");
        assert_eq!(tracks[0].title.as_deref(), Some("Main"));
        assert_eq!(tracks[0].codec.as_deref(), Some("ac3"));
        assert_eq!(tracks[0].audio_channels.as_deref(), Some("5.1(side)"));
        assert_eq!(tracks[0].channel_count, Some(6));
        assert_eq!(tracks[0].sample_rate, Some(48_000));
        assert_eq!(tracks[0].bitrate, Some(640_000));
        assert!(tracks[0].selected);
        assert_eq!(tracks[1].channel_count, Some(2));
        assert_eq!(tracks[2].channel_count, Some(2));
    }
}
