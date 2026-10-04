import fs from "node:fs"
import path from "node:path"
import { rcompare } from "semver"

// Legacy pnpm deploy resolves manifests even when the tarballs are already cached.
// Build its offline registry metadata from installed manifests and pinned sources.
const cache = process.env.XDG_CACHE_HOME
if (!cache) throw new Error("XDG_CACHE_HOME is required")
const sources = JSON.parse(fs.readFileSync("flatpak/node-sources.json", "utf8"))
const tarballs = new Map(
  sources
    .filter((source) => source.url?.endsWith(".tgz"))
    .map((source) => [
      source["dest-filename"],
      {
        tarball: source.url,
        integrity: `sha512-${Buffer.from(source.sha512, "hex").toString("base64")}`,
      },
    ]),
)
const packages = new Map()
for (const filename of fs.globSync([
  "node_modules/.pnpm/*/node_modules/*/package.json",
  "node_modules/.pnpm/*/node_modules/@*/*/package.json",
])) {
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"))
  const dist = tarballs.get(`${manifest.name.replace("/", "__")}-${manifest.version}.tgz`)
  if (!dist) continue
  const versions = packages.get(manifest.name) ?? {}
  versions[manifest.version] = { ...manifest, dist }
  packages.set(manifest.name, versions)
}
for (const [name, versions] of packages) {
  const filename = path.join(cache, "pnpm/metadata-v1.3/registry.npmjs.org", `${name}.json`)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(
    filename,
    JSON.stringify({
      name,
      versions,
      "dist-tags": { latest: Object.keys(versions).sort(rcompare)[0] },
    }),
  )
}
