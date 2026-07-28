use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

#[cfg(unix)]
use std::os::unix::net::UnixStream;

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("mpv could not be started; install mpv or set CONDUIT_MPV_PATH")]
    MissingMpv,
    #[error("mpv IPC did not become ready")]
    IpcUnavailable,
    #[error("mpv is not running")]
    NotRunning,
    #[error("invalid media URL")]
    InvalidUrl,
    #[error("player I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("player returned invalid data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("mpv command failed: {0}")]
    Command(String),
    #[error("player state lock was poisoned")]
    Poisoned,
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

struct PlayerProcess {
    child: Child,
    ipc_path: String,
}

#[derive(Default)]
pub struct PlayerManager {
    process: Mutex<Option<PlayerProcess>>,
}

impl PlayerManager {
    pub fn open(&self, url: &str, title: &str) -> Result<PlayerSnapshot, PlayerError> {
        if !matches!(url.split(':').next(), Some("http" | "https")) {
            return Err(PlayerError::InvalidUrl);
        }
        self.stop()?;

        let ipc_path = ipc_path();
        let executable = std::env::var("CONDUIT_MPV_PATH").unwrap_or_else(|_| "mpv".to_owned());
        let child = Command::new(executable)
            .args([
                "--no-terminal",
                "--force-window=yes",
                "--idle=yes",
                "--input-default-bindings=yes",
                "--osc=yes",
                "--keep-open=yes",
                "--hwdec=auto-safe",
                "--audio-channels=auto-safe",
                &format!("--input-ipc-server={ipc_path}"),
                &format!("--force-media-title={title}"),
                url,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    PlayerError::MissingMpv
                } else {
                    PlayerError::Io(error)
                }
            })?;

        *self.process.lock().map_err(|_| PlayerError::Poisoned)? =
            Some(PlayerProcess { child, ipc_path });
        self.wait_until_ready()?;
        self.snapshot()
    }

    pub fn stop(&self) -> Result<(), PlayerError> {
        let process = self
            .process
            .lock()
            .map_err(|_| PlayerError::Poisoned)?
            .take();
        if let Some(mut process) = process {
            let _ = send(&process.ipc_path, json!(["quit"]));
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(500) {
                if process.child.try_wait()?.is_some() {
                    cleanup_ipc(&process.ipc_path);
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(20));
            }
            process.child.kill()?;
            let _ = process.child.wait();
            cleanup_ipc(&process.ipc_path);
        }
        Ok(())
    }

    pub fn command(&self, command: Vec<Value>) -> Result<Value, PlayerError> {
        let guard = self.process.lock().map_err(|_| PlayerError::Poisoned)?;
        let process = guard.as_ref().ok_or(PlayerError::NotRunning)?;
        send(&process.ipc_path, Value::Array(command))
    }

    pub fn snapshot(&self) -> Result<PlayerSnapshot, PlayerError> {
        let guard = self.process.lock().map_err(|_| PlayerError::Poisoned)?;
        let process = guard.as_ref().ok_or(PlayerError::NotRunning)?;
        Ok(PlayerSnapshot {
            running: process.child.id() > 0,
            paused: property(&process.ipc_path, "pause")
                .unwrap_or(Value::Bool(false))
                .as_bool()
                .unwrap_or(false),
            position: property(&process.ipc_path, "time-pos")
                .unwrap_or(Value::Null)
                .as_f64()
                .unwrap_or_default(),
            duration: property(&process.ipc_path, "duration")
                .unwrap_or(Value::Null)
                .as_f64()
                .unwrap_or_default(),
            volume: property(&process.ipc_path, "volume")
                .unwrap_or(Value::Null)
                .as_f64()
                .unwrap_or(100.0),
            title: property(&process.ipc_path, "media-title")
                .unwrap_or(Value::Null)
                .as_str()
                .map(str::to_owned),
            tracks: serde_json::from_value(
                property(&process.ipc_path, "track-list").unwrap_or_else(|_| json!([])),
            )
            .unwrap_or_default(),
        })
    }

    fn wait_until_ready(&self) -> Result<(), PlayerError> {
        let started = Instant::now();
        // mpv can delay creation of its IPC socket while opening a slow remote
        // source. The player window may already exist during that work, so a
        // short timeout incorrectly reports a launch failure even though
        // playback begins moments later.
        while started.elapsed() < Duration::from_secs(30) {
            {
                let guard = self.process.lock().map_err(|_| PlayerError::Poisoned)?;
                if let Some(process) = guard.as_ref() {
                    if send(&process.ipc_path, json!(["get_property", "mpv-version"])).is_ok() {
                        return Ok(());
                    }
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err(PlayerError::IpcUnavailable)
    }
}

impl Drop for PlayerManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn property(ipc_path: &str, name: &str) -> Result<Value, PlayerError> {
    send(ipc_path, json!(["get_property", name]))
}

#[cfg(unix)]
fn send(ipc_path: &str, command: Value) -> Result<Value, PlayerError> {
    let mut stream = UnixStream::connect(ipc_path)?;
    writeln!(stream, "{}", json!({ "command": command }))?;
    stream.flush()?;
    read_response(stream)
}

#[cfg(windows)]
fn send(ipc_path: &str, command: Value) -> Result<Value, PlayerError> {
    use std::fs::OpenOptions;
    let mut stream = OpenOptions::new().read(true).write(true).open(ipc_path)?;
    writeln!(stream, "{}", json!({ "command": command }))?;
    stream.flush()?;
    read_response(stream)
}

fn read_response(stream: impl std::io::Read) -> Result<Value, PlayerError> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let response: Value = serde_json::from_str(&line)?;
    if response["error"] != "success" {
        return Err(PlayerError::Command(
            response["error"]
                .as_str()
                .unwrap_or("unknown error")
                .to_owned(),
        ));
    }
    Ok(response.get("data").cloned().unwrap_or(Value::Null))
}

fn ipc_path() -> String {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    if cfg!(windows) {
        format!(r"\\.\pipe\conduit-mpv-{}-{nonce}", std::process::id())
    } else {
        format!("/tmp/conduit-mpv-{}-{nonce}.sock", std::process::id())
    }
}

#[cfg(unix)]
fn cleanup_ipc(ipc_path: &str) {
    let _ = std::fs::remove_file(ipc_path);
}

#[cfg(windows)]
fn cleanup_ipc(_: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_media_urls() {
        let manager = PlayerManager::default();
        assert!(matches!(
            manager.open("file:///etc/passwd", "test"),
            Err(PlayerError::InvalidUrl)
        ));
    }

    #[test]
    fn creates_platform_ipc_path() {
        let path = ipc_path();
        assert!(path.contains("conduit-mpv-"));
    }
}
