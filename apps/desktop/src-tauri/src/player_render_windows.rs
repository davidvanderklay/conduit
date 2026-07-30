// The HWND/libmpv embedding structure follows the approach used by Harbor's
// MIT-licensed Tauri player: https://github.com/harborstremio/harbor
#![cfg(target_os = "windows")]

use tauri::{AppHandle, Manager};
use windows::core::BOOL;
use windows::Win32::{
    Foundation::{HWND, LPARAM},
    UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE,
    },
};

pub fn install(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    window
        .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))
        .map_err(|error| error.to_string())?;
    force_mpv_below(window.hwnd().map_err(|error| error.to_string())?)
}

pub fn uninstall(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    window
        .set_background_color(Some(tauri::window::Color(9, 9, 11, 255)))
        .map_err(|error| error.to_string())
}

pub fn refresh(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    force_mpv_below(window.hwnd().map_err(|error| error.to_string())?)
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_owned())
}

fn force_mpv_below(parent: HWND) -> Result<(), String> {
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
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
