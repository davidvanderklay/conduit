fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    probe_linux_egl();
    probe_macos_mpv();
    if target_os == "windows" {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest directory");
        let libmpv = std::path::Path::new(&manifest_dir).join("libmpv");
        if !libmpv.join("mpv.lib").is_file() || !libmpv.join("libmpv-2.dll").is_file() {
            println!(
                "cargo:warning=Windows libmpv files are missing; run `pnpm --filter @conduit/desktop setup:windows` before linking or packaging"
            );
        }
        println!("cargo:rustc-link-search=native={}", libmpv.display());
        println!(
            "cargo:rerun-if-changed={}",
            libmpv.join("mpv.lib").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            libmpv.join("libmpv-2.dll").display()
        );
    }
    tauri_build::build()
}

#[cfg(target_os = "linux")]
fn probe_linux_egl() {
    pkg_config::probe_library("egl").expect("EGL development files are required on Linux");
}

#[cfg(not(target_os = "linux"))]
fn probe_linux_egl() {}

#[cfg(target_os = "macos")]
fn probe_macos_mpv() {
    pkg_config::probe_library("mpv").expect("libmpv development files are required on macOS");
}

#[cfg(not(target_os = "macos"))]
fn probe_macos_mpv() {}
