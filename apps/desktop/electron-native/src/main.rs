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

#[derive(Default)]
struct Player {
    mpv: Option<Mpv>,
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

        self.stop();
        force_c_numeric_locale();

        let nvidia_driver = std::path::Path::new("/proc/driver/nvidia/version").exists();
        let hwdec_override = std::env::var("CONDUIT_MPV_HWDEC").ok();
        let vaapi_device = linux_vaapi_device();
        let mpv_debug_logging = std::env::var_os("CONDUIT_MPV_LOG").is_some();

        let mpv = Mpv::with_initializer(|initializer| {
            // The Electron renderer is an X11 window. libmpv owns a child
            // window inside it, keeping video rendering native while Chromium
            // remains responsible for the rest of the UI.
            initializer.set_option("vo", "gpu-next")?;
            initializer.set_option("gpu-api", "opengl")?;
            initializer.set_option("gpu-context", "x11egl")?;
            initializer.set_option("wid", window_id)?;
            initializer.set_option("force-window", "immediate")?;
            initializer.set_option("terminal", if mpv_debug_logging { "yes" } else { "no" })?;
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
        .map_err(|error| NativeError::Initialization(error.to_string()))?;

        mpv.set_property("force-media-title", params.title.as_str())
            .map_err(|error| NativeError::Command(error.to_string()))?;
        argv_command(&mpv, &["loadfile", params.url.as_str(), "replace"])?;
        self.mpv = Some(mpv);
        // libmpv creates a child X11 window for `wid`. Keep that child below
        // Chromium's content window so the React controls remain interactive
        // while the page itself is transparent during native playback.
        for delay in [0, 25, 100] {
            if delay != 0 {
                std::thread::sleep(std::time::Duration::from_millis(delay));
            }
            lower_mpv_children(window_id as u64);
        }
        self.snapshot()
    }

    fn stop(&mut self) {
        self.mpv.take();
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
fn lower_mpv_children(parent: u64) {
    use std::ffi::CStr;
    use std::ptr;
    use x11::xlib::{
        Window, XClassHint, XCloseDisplay, XFetchName, XFlush, XFree, XGetClassHint, XLowerWindow,
        XOpenDisplay, XQueryTree,
    };

    unsafe {
        let display = XOpenDisplay(ptr::null());
        if display.is_null() {
            return;
        }
        let mut root: Window = 0;
        let mut returned_parent: Window = 0;
        let mut children: *mut Window = ptr::null_mut();
        let mut child_count = 0;
        if XQueryTree(
            display,
            parent as Window,
            &mut root,
            &mut returned_parent,
            &mut children,
            &mut child_count,
        ) != 0
        {
            for index in 0..child_count as isize {
                let child = *children.offset(index);
                let mut class_hint = XClassHint {
                    res_name: ptr::null_mut(),
                    res_class: ptr::null_mut(),
                };
                let mut is_mpv = false;
                if XGetClassHint(display, child, &mut class_hint) != 0 {
                    if !class_hint.res_class.is_null() {
                        let class = CStr::from_ptr(class_hint.res_class).to_string_lossy();
                        is_mpv = class.eq_ignore_ascii_case("mpv") || class.starts_with("mpv ");
                    }
                    if !class_hint.res_name.is_null() {
                        XFree(class_hint.res_name.cast());
                    }
                    if !class_hint.res_class.is_null() {
                        XFree(class_hint.res_class.cast());
                    }
                }
                if !is_mpv {
                    let mut name: *mut i8 = ptr::null_mut();
                    if XFetchName(display, child, &mut name) != 0 && !name.is_null() {
                        let value = CStr::from_ptr(name).to_string_lossy();
                        is_mpv = value.eq_ignore_ascii_case("mpv") || value.starts_with("mpv ");
                        XFree(name.cast());
                    }
                }
                if is_mpv {
                    XLowerWindow(display, child);
                }
            }
            if !children.is_null() {
                XFree(children.cast());
            }
            XFlush(display);
        }
        XCloseDisplay(display);
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
