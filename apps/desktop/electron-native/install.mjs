import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const nativeRoot = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(nativeRoot, "../../..")
const profile = process.env.CARGO_PROFILE === "release" ? "release" : "debug"
const sourceName = process.platform === "win32"
  ? "conduit_electron_native.dll"
  : process.platform === "darwin"
    ? "libconduit_electron_native.dylib"
    : "libconduit_electron_native.so"
const source = path.join(workspaceRoot, "target", profile, sourceName)
const destination = path.join(nativeRoot, "dist", "conduit-electron-native.node")

await mkdir(path.dirname(destination), { recursive: true })
await copyFile(source, destination)
