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
          "pnpm core:build && pnpm --filter @conduit/server build && pnpm --filter @conduit/web build && cargo check -p conduit-desktop",
      },
      "ci:check": {
        command:
          "cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && pnpm -r check",
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
