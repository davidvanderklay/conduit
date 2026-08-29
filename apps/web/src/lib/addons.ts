import type { AddonManifest, InstalledAddon } from "./api"
import { coreValue } from "./core"

export function supportsResource(
  manifest: AddonManifest,
  resource: string,
  type: string,
  id: string,
): boolean {
  return coreValue<boolean>({
    type: "supportsResource",
    manifest,
    resource,
    mediaType: type,
    id,
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
