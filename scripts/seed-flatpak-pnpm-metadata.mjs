import fs from "node:fs"
import path from "node:path"
import { rcompare } from "semver"
import { parse } from "yaml"

// Legacy pnpm deploy resolves manifests even when the tarballs are already cached.
// Build its offline registry metadata from installed manifests and the lockfile.
const cache = process.env.XDG_CACHE_HOME
if (!cache) throw new Error("XDG_CACHE_HOME is required")
const lockfile = parse(fs.readFileSync("pnpm-lock.yaml", "utf8"))
const dists = new Map(
  Object.entries(lockfile.packages).map(([key, { resolution }]) => {
    const separator = key.lastIndexOf("@")
    const name = key.slice(0, separator)
    const version = key.slice(separator + 1)
    const tarball = `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`
    return [key, { tarball, integrity: resolution.integrity }]
  }),
)
const packages = new Map()
for (const filename of fs.globSync([
  "node_modules/.pnpm/*/node_modules/*/package.json",
  "node_modules/.pnpm/*/node_modules/@*/*/package.json",
])) {
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"))
  const dist = dists.get(`${manifest.name}@${manifest.version}`)
  if (!dist?.integrity) continue
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
