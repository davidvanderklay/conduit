import { readFile } from "node:fs/promises"

const lockfile = await readFile("pnpm-lock.yaml", "utf8")
const sources = JSON.parse(await readFile("flatpak/node-sources.json", "utf8"))
const packagesStart = lockfile.indexOf("\npackages:\n")
const snapshotsStart = lockfile.indexOf("\nsnapshots:\n")

if (packagesStart < 0 || snapshotsStart < 0 || snapshotsStart <= packagesStart) {
  throw new Error("Could not locate the packages section in pnpm-lock.yaml")
}

const packageSection = lockfile.slice(packagesStart, snapshotsStart)
const packageEntries = [...packageSection.matchAll(/^  (?<key>[^:\n]+):\n/gm)]
const expectedPackages = new Map()

for (let index = 0; index < packageEntries.length; index += 1) {
  const rawKey = packageEntries[index].groups.key.trim().replace(/^['"]|['"]$/g, "")
  if (!rawKey.includes("@")) continue

  const blockStart = packageEntries[index].index + packageEntries[index][0].length
  const blockEnd = packageEntries[index + 1]?.index ?? packageSection.length
  const block = packageSection.slice(blockStart, blockEnd)
  const integrity = block.match(
    /^\s+resolution:\s+\{integrity:\s+(sha512-[^,}\s]+)/m,
  )?.[1]
  if (!integrity) continue

  const packageKey = rawKey.replace(/\([^)]*\)$/, "")
  const separator = packageKey.lastIndexOf("@")
  if (separator <= 0) continue

  const name = packageKey.slice(0, separator)
  const version = packageKey.slice(separator + 1)
  const filename = `${name.replace("/", "__")}-${version}.tgz`
  const sha512 = Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex")
  expectedPackages.set(filename, sha512)
}

const actualPackages = new Map(
  sources
    .filter((source) => source["dest-filename"]?.endsWith(".tgz"))
    .map((source) => [source["dest-filename"], source.sha512]),
)

const missing = [...expectedPackages.keys()].filter((filename) => !actualPackages.has(filename))
const unexpected = [...actualPackages.keys()].filter((filename) => !expectedPackages.has(filename))
const mismatched = [...expectedPackages.keys()].filter(
  (filename) => expectedPackages.get(filename) !== actualPackages.get(filename),
)

if (missing.length || unexpected.length || mismatched.length) {
  console.error("Flatpak Node sources do not match pnpm-lock.yaml.")
  if (missing.length) console.error(`Missing packages: ${missing.join(", ")}`)
  if (unexpected.length) console.error(`Unexpected packages: ${unexpected.join(", ")}`)
  if (mismatched.length) console.error(`Mismatched integrity: ${mismatched.join(", ")}`)
  console.error(
    "Regenerate with flatpak-node-generator pnpm pnpm-lock.yaml -o flatpak/node-sources.json.",
  )
  process.exitCode = 1
}
