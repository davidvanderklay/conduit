fn main() {
    #[cfg(target_os = "linux")]
    {
        pkg_config::probe_library("mpv").expect("libmpv development files are required");
        pkg_config::probe_library("egl").expect("EGL development files are required");
    }
}
