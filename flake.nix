{
  description = "Conduit media operating system";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            pnpm
            jdk17
            rustc
            cargo
            rustfmt
            clippy
            lld
            wasm-pack
            pkg-config
            openssl
            postgresql_17
            mpv
            dbus
            electron
            glib
            gtk3
            libglvnd
            libsoup_3
            webkitgtk_4_1
            librsvg
            cargo-tauri
          ];

          shellHook = ''
            export RUST_BACKTRACE=1
            export CONDUIT_ELECTRON_BIN="$(command -v electron)"
          '';
        };
      });
}
