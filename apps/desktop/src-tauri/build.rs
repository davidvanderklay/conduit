fn main() {
    #[cfg(target_os = "linux")]
    pkg_config::probe_library("egl").expect("EGL development files are required on Linux");
    tauri_build::build()
}
