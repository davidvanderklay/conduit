mod player;
#[cfg(target_os = "linux")]
mod player_render_linux;
#[cfg(target_os = "macos")]
mod player_render_macos;
#[cfg(target_os = "windows")]
mod player_render_windows;

use player::{PlayerManager, PlayerSnapshot};
use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthListener {
    callback_url: String,
}

#[tauri::command]
fn desktop_auth_listen(app: AppHandle) -> Result<DesktopAuthListener, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let callback_url = format!("http://127.0.0.1:{}/oauth/callback", address.port());
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5 * 60);
        while Instant::now() < deadline {
            let accepted = match listener.accept() {
                Ok(value) => Some(value),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                    None
                }
                Err(_) => return,
            };
            let Some((mut stream, _)) = accepted else {
                continue;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
            let mut buffer = [0_u8; 8192];
            if let Ok(read) = stream.read(&mut buffer) {
                if let Some(target) = parse_callback_target(&buffer[..read]) {
                    let callback = format!("http://127.0.0.1:{}{}", address.port(), target);
                    let _ = app.emit("desktop-auth-callback", callback);
                }
            }
            let body = concat!(
                "<!doctype html><html><head><meta charset=\"utf-8\">",
                "<meta name=\"viewport\" content=\"width=device-width\">",
                "<title>Signed in to Conduit</title>",
                "<style>body{color-scheme:dark;background:#09090b;color:#e4e4e7;",
                "font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}",
                "main{text-align:center;max-width:32rem;padding:2rem}h1{font-size:1.5rem}",
                "p{color:#a1a1aa;line-height:1.6}</style></head>",
                "<body><main><h1>Return to Conduit</h1>",
                "<p>Authentication is complete. You can close this tab and continue in the app.</p>",
                "</main></body></html>"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                 Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n\
                 Cache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            return;
        }
    });
    Ok(DesktopAuthListener { callback_url })
}

fn parse_callback_target(request: &[u8]) -> Option<&str> {
    let request = std::str::from_utf8(request).ok()?;
    let first_line = request.lines().next()?;
    let mut parts = first_line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/oauth/callback?") {
        return None;
    }
    Some(target)
}

#[tauri::command]
async fn player_open(
    app: AppHandle,
    player: State<'_, PlayerManager>,
    url: String,
    title: String,
) -> Result<PlayerSnapshot, String> {
    player
        .open(&app, &url, &title)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn player_snapshot(player: State<'_, PlayerManager>) -> Result<PlayerSnapshot, String> {
    player.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn player_command(
    player: State<'_, PlayerManager>,
    command: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    player.command(command).map_err(|error| error.to_string())
}

#[tauri::command]
async fn player_stop(app: AppHandle, player: State<'_, PlayerManager>) -> Result<(), String> {
    player.stop(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn player_refresh_surface(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    app.run_on_main_thread(crate::player_render_linux::reconfigure)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn player_redraw_surface(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    app.run_on_main_thread(crate::player_render_linux::refresh)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn player_reset_overlay_surface(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    app.run_on_main_thread(crate::player_render_linux::reset_webview)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn player_toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_owned())?;
    let fullscreen = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(fullscreen)
        .map_err(|error| error.to_string())?;
    Ok(fullscreen)
}

#[tauri::command]
fn player_is_fullscreen(app: AppHandle) -> Result<bool, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_owned())?
        .is_fullscreen()
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_webkit();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PlayerManager::default())
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "linux")]
            if matches!(_event, tauri::WindowEvent::Resized(_)) {
                crate::player_render_linux::refresh();
            }
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::WindowEvent::Resized(_)) {
                let _ = crate::player_render_macos::refresh();
            }
            #[cfg(target_os = "windows")]
            if matches!(
                _event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                let _ = crate::player_render_windows::refresh(_window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            player_open,
            player_snapshot,
            player_command,
            player_stop,
            player_refresh_surface,
            player_redraw_surface,
            player_reset_overlay_surface,
            player_toggle_fullscreen,
            player_is_fullscreen,
            desktop_auth_listen
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Conduit desktop");
}

#[cfg(test)]
mod desktop_auth_tests {
    use super::parse_callback_target;

    #[test]
    fn accepts_only_the_oauth_loopback_path() {
        assert_eq!(
            parse_callback_target(b"GET /oauth/callback?code=abc HTTP/1.1\r\nHost: localhost\r\n"),
            Some("/oauth/callback?code=abc")
        );
        assert_eq!(parse_callback_target(b"GET / HTTP/1.1\r\n"), None);
        assert_eq!(
            parse_callback_target(b"POST /oauth/callback?code=abc HTTP/1.1\r\n"),
            None
        );
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_webkit() {
    let wayland_session = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let native_wayland_requested = std::env::var_os("CONDUIT_NATIVE_WAYLAND").is_some();
    let xwayland_available = std::env::var_os("DISPLAY").is_some();
    let native_wayland = wayland_session && (native_wayland_requested || !xwayland_available);
    let nvidia_driver = std::path::Path::new("/proc/driver/nvidia/version").exists();

    if wayland_session && !native_wayland_requested && xwayland_available {
        // WebKitGTK's input and presentation surfaces become stale when they
        // are layered above GtkGLArea on native Wayland. XWayland keeps the
        // same desktop session while providing stable OpenGL composition.
        std::env::set_var("GDK_BACKEND", "x11");
        eprintln!("Conduit: using XWayland for stable embedded video composition");
    }

    if (native_wayland || nvidia_driver)
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        // WebKitGTK's DMA-BUF renderer can negotiate explicit synchronization
        // and then submit a non-DMA-BUF buffer, which is a fatal Wayland
        // protocol error on affected Mesa/NVIDIA compositor combinations.
        // Some NVIDIA GBM stacks also reject WebKit's XWayland buffers.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        eprintln!("Conduit: disabled unsupported WebKit DMA-BUF renderer");
    }
    if wayland_session
        && native_wayland
        && nvidia_driver
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
    {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
}
