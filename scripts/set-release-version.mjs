import fs from "node:fs"

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error(`Invalid release version: ${version ?? "(missing)"}`)
}

const configPath = new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url)
const cargoPath = new URL("../apps/desktop/src-tauri/Cargo.toml", import.meta.url)
const config = JSON.parse(fs.readFileSync(configPath, "utf8"))

config.version = version
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

const cargo = fs.readFileSync(cargoPath, "utf8")
fs.writeFileSync(
  cargoPath,
  cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+(")/, `$1${version}$2`),
)
