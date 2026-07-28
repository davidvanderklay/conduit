mod player;

use player::{PlayerManager, PlayerSnapshot};
use tauri::State;

#[tauri::command]
fn player_open(
    player: State<'_, PlayerManager>,
    url: String,
    title: String,
) -> Result<PlayerSnapshot, String> {
    player.open(&url, &title).map_err(|error| error.to_string())
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
fn player_stop(player: State<'_, PlayerManager>) -> Result<(), String> {
    player.stop().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PlayerManager::default())
        .invoke_handler(tauri::generate_handler![
            player_open,
            player_snapshot,
            player_command,
            player_stop
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Conduit desktop");
}
