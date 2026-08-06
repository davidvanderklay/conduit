import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const nativeRoot = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.join(nativeRoot, "Cargo.toml")
const targetArgs = process.platform === "linux"
  ? ["--bin", "conduit-electron-native", "--features", "linux-helper"]
  : ["--lib"]

const build = spawnSync(
  "cargo",
  ["build", "--manifest-path", manifestPath, ...targetArgs],
  { stdio: "inherit" },
)

if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

if (process.platform !== "linux") {
  await import("./install.mjs")
}
