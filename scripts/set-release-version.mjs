import fs from "node:fs"

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error(`Invalid release version: ${version ?? "(missing)"}`)
}

const desktopPackagePath = new URL("../apps/desktop/package.json", import.meta.url)
const electronNativeCargoPath = new URL("../apps/desktop/electron-native/Cargo.toml", import.meta.url)
const metainfoPath = new URL("../flatpak/media.conduit.desktop.metainfo.xml", import.meta.url)

// Bump Electron desktop version
const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8"))
desktopPackage.version = version
fs.writeFileSync(desktopPackagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`)

const cargo = fs.readFileSync(electronNativeCargoPath, "utf8")
fs.writeFileSync(
  electronNativeCargoPath,
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
