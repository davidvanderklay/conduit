import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: false,
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "packages/core/pkg/**"],
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
