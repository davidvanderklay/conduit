import type { AddonManifest, InstalledAddon } from "./api"

export function supportsResource(
  manifest: AddonManifest,
  resource: string,
  type: string,
  id: string,
): boolean {
  return manifest.resources.some((candidate) => {
    if (typeof candidate === "string") return candidate === resource
    if (candidate.name !== resource) return false
    if (candidate.types?.length && !candidate.types.includes(type)) return false
    if (
      candidate.idPrefixes?.length &&
      !candidate.idPrefixes.some((prefix) => id.startsWith(prefix))
    ) {
      return false
    }
    return true
  })
}

export function addonsForResource(
  addons: InstalledAddon[],
  resource: string,
  type: string,
  id: string,
): InstalledAddon[] {
  return addons.filter(
    (addon) => addon.enabled && supportsResource(addon.manifest, resource, type, id),
  )
}
