use libmpv2::{mpv_node::MpvNode, Mpv};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::time::Duration;
use std::{
    ffi::CString,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("embedded libmpv could not be initialized: {0}")]
    Initialization(String),
    #[error("mpv is not running")]
    NotRunning,
    #[error("invalid media URL")]
    InvalidUrl,
    #[error("mpv command failed: {0}")]
    Command(String),
    #[error("embedded player state lock was poisoned")]
    Poisoned,
    #[error("embedded player surface failed: {0}")]
    Surface(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTrack {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub lang: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub selected: bool,
    #[serde(default)]
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub running: bool,
    pub ended: bool,
    pub paused: bool,
    pub loading: bool,
    pub position: f64,
    pub duration: f64,
    pub buffered_duration: f64,
    pub volume: f64,
    pub title: Option<String>,
    pub tracks: Vec<PlayerTrack>,
}

struct PlayerSession {
    mpv: Arc<Mpv>,
}

#[derive(Default)]
pub struct PlayerManager {
    session: Mutex<Option<PlayerSession>>,
}

impl PlayerManager {
    pub fn open(
        &self,
        app: &AppHandle,
        url: &str,
        title: &str,
        read_ahead_seconds: u32,
    ) -> Result<PlayerSnapshot, PlayerError> {
        if !valid_media_url(url) {
            return Err(PlayerError::InvalidUrl);
        }
        self.stop(app)?;
        force_c_numeric_locale();

        #[cfg(target_os = "windows")]
        let embed_hwnd = app
            .get_webview_window("main")
            .ok_or_else(|| PlayerError::Surface("main window is unavailable".into()))?
            .hwnd()
            .map_err(|error| PlayerError::Surface(error.to_string()))?
            .0 as isize as i64;

        let mpv = Mpv::with_initializer(|initializer| {
            #[cfg(not(target_os = "windows"))]
            initializer.set_option("vo", "libmpv")?;
            #[cfg(target_os = "windows")]
            {
                // On Windows mpv owns a child HWND rather than using the
                // callback render API. WebView2 remains above it and supplies
                // Conduit's controls through a transparent background.
                initializer.set_option("vo", "gpu-next")?;
                initializer.set_option("gpu-api", "d3d11")?;
                initializer.set_option("wid", embed_hwnd)?;
            }
            #[cfg(not(target_os = "windows"))]
            initializer.set_option("force-window", "no")?;
            #[cfg(target_os = "windows")]
            initializer.set_option("force-window", "immediate")?;
            initializer.set_option("terminal", "no")?;
            initializer.set_option("input-default-bindings", "no")?;
            initializer.set_option("input-cursor", "no")?;
            initializer.set_option("osd-level", "0")?;
            if is_network_media_url(url) {
                for (name, value) in network_buffer_options(read_ahead_seconds) {
                    initializer.set_option(name, value)?;
                }
            }
            #[cfg(target_os = "linux")]
            {
                // Decode on NVIDIA, but copy decoded frames back before
                // uploading them through libmpv's OpenGL renderer. This avoids
                // the fragile CUDA/OpenGL zero-copy interop path while keeping
                // high-resolution playback and seeking off the CPU.
                initializer.set_option("hwdec", "nvdec-copy,auto-copy-safe")?;
                initializer.set_option("gpu-hwdec-interop", "no")?;
                initializer.set_option("vd-lavc-dr", "no")?;
            }
            #[cfg(not(target_os = "linux"))]
            initializer.set_option("hwdec", "auto-safe")?;
            initializer.set_option("audio-channels", "auto-safe")?;
            initializer.set_option("video-timing-offset", "0")?;
            Ok(())
        })
        .map_err(|error| PlayerError::Initialization(error.to_string()))?;
        let mpv = Arc::new(mpv);

        install_surface(app, &mpv)?;
        mpv.set_property("force-media-title", title)
            .map_err(|error| PlayerError::Command(error.to_string()))?;
        argv_command(&mpv, &["loadfile", url, "replace"])?;
        #[cfg(target_os = "windows")]
        crate::player_render_windows::refresh(app).map_err(PlayerError::Surface)?;

        *self.session.lock().map_err(|_| PlayerError::Poisoned)? = Some(PlayerSession { mpv });
        // libmpv is initialized synchronously, but media properties arrive
        // asynchronously after loadfile. The UI polling loop fills them in.
        self.snapshot()
    }

    pub fn stop(&self, app: &AppHandle) -> Result<(), PlayerError> {
        let session = self
            .session
            .lock()
            .map_err(|_| PlayerError::Poisoned)?
            .take();
        if let Some(session) = session {
            // Freeing an active render context already disables video. Avoid a
            // synchronous normal mpv command immediately before waiting for
            // teardown on the render thread; libmpv explicitly warns that
            // this lock dependency can deadlock.
            uninstall_surface(app)?;
            drop(session);
        }
        Ok(())
    }

    pub fn command(&self, command: Vec<Value>) -> Result<Value, PlayerError> {
        #[cfg(debug_assertions)]
        eprintln!("Conduit player command: {}", Value::Array(command.clone()));
        let guard = self.session.lock().map_err(|_| PlayerError::Poisoned)?;
        let mpv = &guard.as_ref().ok_or(PlayerError::NotRunning)?.mpv;
        let args = command.iter().map(value_to_arg).collect::<Vec<_>>();
        if args.is_empty() {
            return Err(PlayerError::Command("empty command".into()));
        }
        let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        argv_command(mpv, &refs)?;
        Ok(Value::Null)
    }

    pub fn snapshot(&self) -> Result<PlayerSnapshot, PlayerError> {
        let guard = self.session.lock().map_err(|_| PlayerError::Poisoned)?;
        let mpv = &guard.as_ref().ok_or(PlayerError::NotRunning)?.mpv;
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
        })
    }
}

fn network_buffer_options(read_ahead_seconds: u32) -> Vec<(&'static str, String)> {
    let seconds = read_ahead_seconds.clamp(10, 120);
    vec![
        ("cache", "yes".into()),
        // mpv's on-disk cache is append-only and only deleted after playback,
        // so keep Conduit's cache bounded in memory.
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

fn argv_command(mpv: &Mpv, args: &[&str]) -> Result<(), PlayerError> {
    let strings = args
        .iter()
        .map(|arg| CString::new(*arg))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PlayerError::Command(error.to_string()))?;
    let mut pointers = strings
        .iter()
        .map(|arg| arg.as_ptr())
        .chain(std::iter::once(std::ptr::null()))
        .collect::<Vec<_>>();
    let result = unsafe { libmpv2_sys::mpv_command(mpv.ctx.as_ptr(), pointers.as_mut_ptr()) };
    if result < 0 {
        Err(PlayerError::Command(format!("mpv error {result}")))
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

#[cfg(target_os = "macos")]
fn install_surface(app: &AppHandle, mpv: &Arc<Mpv>) -> Result<(), PlayerError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| PlayerError::Surface("main window is unavailable".into()))?;
    let ns_window = window
        .ns_window()
        .map_err(|error| PlayerError::Surface(error.to_string()))? as i64;
    let context = mpv.ctx.as_ptr() as usize;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let context = std::ptr::NonNull::new(context as *mut libmpv2_sys::mpv_handle)
            .ok_or_else(|| "libmpv returned a null context".to_owned())
            .and_then(|context| crate::player_render_macos::install(context, ns_window));
        let _ = tx.send(context);
    })
    .map_err(|error| PlayerError::Surface(error.to_string()))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| PlayerError::Surface("surface installation timed out".into()))?
        .map_err(PlayerError::Surface)
}

#[cfg(target_os = "macos")]
fn uninstall_surface(app: &AppHandle) -> Result<(), PlayerError> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(crate::player_render_macos::uninstall());
    })
    .map_err(|error| PlayerError::Surface(error.to_string()))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| PlayerError::Surface("surface removal timed out".into()))?
        .map_err(PlayerError::Surface)
}

#[cfg(target_os = "linux")]
fn install_surface(app: &AppHandle, mpv: &Arc<Mpv>) -> Result<(), PlayerError> {
    let context = mpv.ctx.as_ptr() as usize;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| PlayerError::Surface("main window is unavailable".into()))?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let context = std::ptr::NonNull::new(context as *mut libmpv2_sys::mpv_handle)
            .ok_or_else(|| "libmpv returned a null context".to_owned())
            .and_then(|context| crate::player_render_linux::install(context, &window));
        let _ = tx.send(context);
    })
    .map_err(|error| PlayerError::Surface(error.to_string()))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| PlayerError::Surface("surface installation timed out".into()))?
        .map_err(PlayerError::Surface)
}

#[cfg(target_os = "linux")]
fn uninstall_surface(app: &AppHandle) -> Result<(), PlayerError> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(crate::player_render_linux::uninstall());
    })
    .map_err(|error| PlayerError::Surface(error.to_string()))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| PlayerError::Surface("surface removal timed out".into()))?
        .map_err(PlayerError::Surface)
}

#[cfg(target_os = "windows")]
fn install_surface(app: &AppHandle, _: &Arc<Mpv>) -> Result<(), PlayerError> {
    crate::player_render_windows::install(app).map_err(PlayerError::Surface)
}

#[cfg(target_os = "windows")]
fn uninstall_surface(app: &AppHandle) -> Result<(), PlayerError> {
    crate::player_render_windows::uninstall(app).map_err(PlayerError::Surface)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn install_surface(_: &AppHandle, _: &Arc<Mpv>) -> Result<(), PlayerError> {
    Err(PlayerError::Surface(
        "embedded rendering is not implemented for this platform yet".into(),
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn uninstall_surface(_: &AppHandle) -> Result<(), PlayerError> {
    Ok(())
}

#[cfg(unix)]
fn force_c_numeric_locale() {
    unsafe {
        libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
    }
}

#[cfg(not(unix))]
fn force_c_numeric_locale() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_command_values() {
        assert_eq!(value_to_arg(&json!(true)), "yes");
        assert_eq!(value_to_arg(&json!(12.5)), "12.5");
    }

    #[test]
    fn accepts_remote_and_local_media_urls() {
        assert!(valid_media_url("https://example.test/video.mp4"));
        assert!(valid_media_url("file:///C:/Users/test/video.mp4"));
        assert!(!valid_media_url("javascript:alert(1)"));
        assert!(!valid_media_url("C:\\Users\\test\\video.mp4"));
        assert!(is_network_media_url("https://example.test/video.mp4"));
        assert!(!is_network_media_url("file:///C:/Users/test/video.mp4"));
    }

    #[test]
    fn bounds_and_explicitly_configures_network_buffering() {
        let options = network_buffer_options(500)
            .into_iter()
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(options.get("cache"), Some(&"yes".to_string()));
        assert_eq!(options.get("cache-on-disk"), Some(&"no".to_string()));
        assert_eq!(options.get("cache-secs"), Some(&"120".to_string()));
        assert_eq!(
            options.get("demuxer-max-back-bytes"),
            Some(&"75MiB".to_string())
        );
        assert_eq!(options.get("cache-pause-initial"), Some(&"yes".to_string()));
        assert_eq!(options.get("network-timeout"), Some(&"30".to_string()));
    }
}
