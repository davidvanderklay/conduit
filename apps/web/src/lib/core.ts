import init, { fetchManifest, fetchResource } from "../../../../packages/core/pkg/conduit_core.js"
import type { AddonManifest } from "./api"

let initialization: Promise<unknown> | undefined

function ready() {
  initialization ??= init()
  return initialization
}

export async function loadManifest(url: string): Promise<AddonManifest> {
  await ready()
  return (await fetchManifest(url)) as AddonManifest
}

export interface CatalogItem {
  id: string
  type: string
  name: string
  poster?: string
  background?: string
  description?: string
}

export async function loadCatalog(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<CatalogItem[]> {
  await ready()
  const response = (await fetchResource(manifestUrl, "catalog", type, id, [])) as {
    metas?: CatalogItem[]
  }
  return response.metas ?? []
}
