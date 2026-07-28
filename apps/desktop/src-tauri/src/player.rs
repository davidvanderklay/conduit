use libmpv2::{mpv_node::MpvNode, Mpv};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::CString,
    sync::{Arc, Mutex},
};
#[cfg(target_os = "macos")]
use std::time::Duration;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Manager;
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
    pub paused: bool,
    pub position: f64,
    pub duration: f64,
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
    ) -> Result<PlayerSnapshot, PlayerError> {
        if !matches!(url.split(':').next(), Some("http" | "https")) {
            return Err(PlayerError::InvalidUrl);
        }
        self.stop(app)?;
        force_c_numeric_locale();

        let mpv = Mpv::with_initializer(|initializer| {
            initializer.set_property("vo", "libmpv")?;
            initializer.set_property("force-window", "no")?;
            initializer.set_property("terminal", "no")?;
            initializer.set_property("input-default-bindings", "no")?;
            initializer.set_property("input-cursor", "no")?;
            initializer.set_property("osc", "no")?;
            initializer.set_property("osd-level", "0")?;
            initializer.set_property("hwdec", "auto-safe")?;
            initializer.set_property("audio-channels", "auto-safe")?;
            initializer.set_property("video-timing-offset", "0")?;
            Ok(())
        })
        .map_err(|error| PlayerError::Initialization(error.to_string()))?;
        let mpv = Arc::new(mpv);

        install_surface(app, &mpv)?;
        mpv.set_property("force-media-title", title)
            .map_err(|error| PlayerError::Command(error.to_string()))?;
        argv_command(&mpv, &["loadfile", url, "replace"])?;

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
            let _ = session.mpv.command("stop", &[]);
            uninstall_surface(app)?;
            drop(session);
        }
        Ok(())
    }

    pub fn command(&self, command: Vec<Value>) -> Result<Value, PlayerError> {
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
            paused: mpv.get_property::<bool>("pause").unwrap_or(false),
            position: mpv.get_property::<f64>("time-pos").unwrap_or_default(),
            duration: mpv.get_property::<f64>("duration").unwrap_or_default(),
            volume: mpv.get_property::<f64>("volume").unwrap_or(100.0),
            title: mpv.get_property::<String>("media-title").ok(),
            tracks,
        })
    }
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

#[cfg(not(target_os = "macos"))]
fn install_surface(_: &AppHandle, _: &Arc<Mpv>) -> Result<(), PlayerError> {
    Err(PlayerError::Surface(
        "embedded rendering is not implemented for this platform yet".into(),
    ))
}

#[cfg(not(target_os = "macos"))]
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
}
