fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "linux" {
        pkg_config::probe_library("egl").expect("EGL development files are required on Linux");
    }
    if target_os == "windows" {
        let libmpv = std::path::Path::new("libmpv");
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
