fn main() {
    #[cfg(not(target_os = "linux"))]
    napi_build::setup();
    #[cfg(target_os = "windows")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("manifest directory");
        let libmpv = std::path::Path::new(&manifest_dir).join("../libmpv");
        println!("cargo:rustc-link-search=native={}", libmpv.display());
        println!("cargo:rustc-link-lib=dylib=mpv");
        println!(
            "cargo:rerun-if-changed={}",
            libmpv.join("mpv.lib").display()
        );
    }
    #[cfg(target_os = "macos")]
    {
        // libmpv2-sys probes mpv via pkg-config but the final cdylib link
        // still needs the search path on macOS where brew installs to
        // /opt/homebrew (arm64) or /usr/local (intel). Ensure we probe here
        // so -L flags are emitted for the top-level crate as well.
        pkg_config::probe_library("mpv").expect("libmpv development files are required (brew install mpv)");
    }
    #[cfg(target_os = "linux")]
    {
        pkg_config::probe_library("mpv").expect("libmpv development files are required");
        pkg_config::probe_library("egl").expect("EGL development files are required");
    }
}
