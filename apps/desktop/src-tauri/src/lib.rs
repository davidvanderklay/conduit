mod player;
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
    tauri::Builder::default()
        .manage(PlayerManager::default())
        .on_window_event(|_, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::WindowEvent::Resized(_)) {
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
