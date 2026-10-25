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

// The torrent helper ships beside the player so `player_open` can stream magnets.
const p2pBinary = process.platform === "win32" ? "conduit-p2p.exe" : "conduit-p2p"
const p2pBuild = spawnSync(
  "cargo",
  ["build", "-p", "conduit-p2p", "--bin", "conduit-p2p", ...(release ? ["--release"] : [])],
  { cwd: path.resolve(nativeRoot, "../../.."), stdio: "inherit" },
)
if (p2pBuild.error) throw p2pBuild.error
if (p2pBuild.status !== 0) process.exit(p2pBuild.status ?? 1)
await mkdir(path.join(nativeRoot, "dist"), { recursive: true })
await copyFile(
  path.resolve(nativeRoot, "../../..", "target", profile, p2pBinary),
  path.join(nativeRoot, "dist", p2pBinary),
)

if (process.platform === "linux") {
  const source = path.resolve(nativeRoot, "../../..", "target", profile, "conduit-electron-native")
  const dist = path.join(nativeRoot, "dist")
  await mkdir(dist, { recursive: true })
  await copyFile(source, path.join(dist, "conduit-electron-native"))
} else {
  process.env.CARGO_PROFILE = profile
  await import("./install.mjs")
}
