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
        linuxDesktopLibraries = with pkgs; [
          libglvnd
          libx11
          libxext
          libxi
          libxrender
          libxtst
          libxcb
          libxcomposite
          libxdamage
          libxfixes
          libxrandr
          libxkbcommon
          fontconfig
          freetype
          stdenv.cc.cc.lib
          gtk3
          webkitgtk_4_1
          libsecret
        ];
      in {
        devShells.default = pkgs.mkShell {
          packages = (with pkgs; [
            nodejs_22
            pnpm
            yarn
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
            electron
          ]) ++ pkgs.lib.optionals pkgs.stdenv.isDarwin (with pkgs; [
            libiconv
          ]) ++ pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
            dbus
            glib
            libglvnd
            libx11
            gtk3
            webkitgtk_4_1
            libsecret
          ]);

          shellHook = ''
            export RUST_BACKTRACE=1
            export CONDUIT_ELECTRON_BIN="$(command -v electron)"
            ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxDesktopLibraries}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            ''}
          '';
        };
      });
}
