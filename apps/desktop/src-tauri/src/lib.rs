mod player;
#[cfg(target_os = "linux")]
mod player_render_linux;
#[cfg(target_os = "macos")]
mod player_render_macos;

use player::{PlayerManager, PlayerSnapshot};
use tauri::{AppHandle, Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_webkit();

    tauri::Builder::default()
        .manage(PlayerManager::default())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                let window = app
                    .get_webview_window("main")
                    .ok_or("main window is unavailable")?;
                crate::player_render_linux::initialize(&window)
                    .map_err(|error| format!("Linux player surface: {error}"))?;
            }
            Ok(())
        })
        .on_window_event(|_, _event| {
            #[cfg(target_os = "linux")]
            if matches!(_event, tauri::WindowEvent::Resized(_)) {
                crate::player_render_linux::refresh();
            }
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::WindowEvent::Resized(_)) {
                let _ = crate::player_render_macos::refresh();
            }
        })
        .invoke_handler(tauri::generate_handler![
            player_open,
            player_snapshot,
            player_command,
            player_stop,
            player_toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Conduit desktop");
}

#[cfg(target_os = "linux")]
fn configure_linux_webkit() {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    if wayland && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // WebKitGTK's DMA-BUF renderer can negotiate explicit synchronization
        // and then submit a non-DMA-BUF buffer, which is a fatal Wayland
        // protocol error on affected Mesa/NVIDIA compositor combinations.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if wayland
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
    {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
}
