import fs from "node:fs"

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error(`Invalid release version: ${version ?? "(missing)"}`)
}

const configPath = new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url)
const cargoPath = new URL("../apps/desktop/src-tauri/Cargo.toml", import.meta.url)
const metainfoPath = new URL("../flatpak/media.conduit.desktop.metainfo.xml", import.meta.url)
const config = JSON.parse(fs.readFileSync(configPath, "utf8"))

config.version = version
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

const cargo = fs.readFileSync(cargoPath, "utf8")
fs.writeFileSync(
  cargoPath,
  cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+(")/, `$1${version}$2`),
)

const releaseDate = process.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
  throw new Error(`Invalid release date: ${releaseDate}`)
}

const metainfo = fs.readFileSync(metainfoPath, "utf8")
const releases = `  <releases>\n    <release version="${version}" date="${releaseDate}" />\n  </releases>`
const updatedMetainfo = metainfo.includes("  <releases>")
  ? metainfo.replace(/  <releases>[\s\S]*?  <\/releases>/, releases)
  : metainfo.replace("  <content_rating", `${releases}\n  <content_rating`)

if (updatedMetainfo === metainfo) {
  throw new Error("Could not update Flatpak release metadata")
}
fs.writeFileSync(metainfoPath, updatedMetainfo)
