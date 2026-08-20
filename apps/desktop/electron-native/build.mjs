import { copyFile, mkdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const nativeRoot = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.join(nativeRoot, "Cargo.toml")
const release = process.argv.includes("--release")
const profile = release ? "release" : "debug"
const targetArgs = process.platform === "linux"
  ? ["--bin", "conduit-electron-native", "--features", "linux-helper"]
  : ["--lib"]

const build = spawnSync(
  "cargo",
  ["build", "--manifest-path", manifestPath, ...(release ? ["--release"] : []), ...targetArgs],
  { stdio: "inherit" },
)

if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

if (process.platform === "linux") {
  const source = path.resolve(nativeRoot, "../../..", "target", profile, "conduit-electron-native")
  const dist = path.join(nativeRoot, "dist")
  await mkdir(dist, { recursive: true })
  await copyFile(source, path.join(dist, "conduit-electron-native"))
} else {
  process.env.CARGO_PROFILE = profile
  await import("./install.mjs")
}
