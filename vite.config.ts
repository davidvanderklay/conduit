import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: false,
    // Emscripten output, rebuilt by apps/web/wasm/build.sh.
    ignorePatterns: ["apps/web/src/lib/web-engine/wasm/*.mjs"],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/core/pkg/**",
      "apps/web/src/lib/web-engine/wasm/*.mjs",
    ],
  },
  run: {
    tasks: {
      "ci:build": {
        command:
          "pnpm core:build && pnpm --filter @conduit/server build && pnpm --filter @conduit/web build && (if ! pkg-config --exists mpv 2>/dev/null; then echo 'Skipping conduit-electron-native check (pkg-config mpv not found)'; else cargo check -p conduit-electron-native; fi)",
      },
      "ci:check": {
        command:
          "pnpm lint && cargo fmt --all -- --check && cargo clippy --workspace --exclude conduit-electron-native --all-targets -- -D warnings && (if ! pkg-config --exists mpv 2>/dev/null; then echo 'Skipping conduit-electron-native clippy (pkg-config mpv not found)'; else cargo clippy -p conduit-electron-native -- -D warnings -A dead_code || cargo check -p conduit-electron-native; fi) && pnpm -r check",
      },
      "app:dev": {
        command: "pnpm --parallel --filter @conduit/server --filter @conduit/web dev",
      },
      "ci:test": {
        command: "cargo test --workspace && pnpm -r test",
      },
    },
  },
})
