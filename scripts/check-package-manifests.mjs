import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"

const root = process.cwd()
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]

async function findPackageManifests(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const manifests = []
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      manifests.push(...await findPackageManifests(entryPath))
    } else if (entry.name === "package.json") {
      manifests.push(entryPath)
    }
  }
  return manifests
}

const manifests = await findPackageManifests(root)
const violations = []

// Dependabot bumps vite-plus-core but not the `vite` aliases that point at it.
const vitePlusCore = "@voidzero-dev/vite-plus-core"
const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const viteAlias = `npm:${vitePlusCore}@${rootManifest.devDependencies[vitePlusCore]}`
const workspace = parse(await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8"))
if (workspace.overrides?.vite !== viteAlias) {
  violations.push(`pnpm-workspace.yaml: overrides.vite must be ${viteAlias}`)
}

for (const manifestPath of manifests) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  for (const field of dependencyFields) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (specifier === "latest" || specifier.endsWith("@latest")) {
        violations.push(`${path.relative(root, manifestPath)}: ${field}.${name} uses ${specifier}`)
      }
      if (specifier.startsWith(`npm:${vitePlusCore}@`) && specifier !== viteAlias) {
        violations.push(`${path.relative(root, manifestPath)}: ${field}.${name} must be ${viteAlias}`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Package manifests must use intentional, aligned dependency versions:")
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
}
