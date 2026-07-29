import type { InstalledAddon } from "./api"
import { loadCatalog, type CatalogItem } from "./core"

export interface SearchSource {
  addonId: string
  addonName: string
  catalogId: string
  catalogName: string
  type: string
}

export interface SearchResult extends CatalogItem {
  sources: SearchSource[]
}

export interface SearchResponse {
  results: SearchResult[]
  failedSources: number
  totalSources: number
}

export interface SearchCatalog {
  addon: InstalledAddon
  id: string
  type: string
}

export function searchableCatalogs(addons: InstalledAddon[]): SearchCatalog[] {
  return addons
    .filter((addon) => addon.enabled)
    .flatMap((addon) =>
      addon.manifest.catalogs
        .filter(
          (catalog) =>
            catalog.extra?.some((extra) => extra.name === "search") &&
            catalog.extra.every((extra) => !extra.isRequired || extra.name === "search"),
        )
        .map((catalog) => ({ addon, id: catalog.id, type: catalog.type })),
    )
}

export async function searchAddons(
  addons: InstalledAddon[],
  query: string,
  options: {
    timeoutMs?: number
    load?: typeof loadCatalog
  } = {},
): Promise<SearchResponse> {
  const catalogs = searchableCatalogs(addons)
  const timeoutMs = options.timeoutMs ?? 8_000
  const load = options.load ?? loadCatalog
  const settled = await Promise.allSettled(
    catalogs.map(async (catalog) => {
      const items = await withTimeout(
        load(catalog.addon.manifestUrl, catalog.type, catalog.id, [
          { name: "search", value: query },
        ]),
        timeoutMs,
      )
      return { catalog, items }
    }),
  )

  const merged = new Map<string, SearchResult>()
  let failedSources = 0
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      failedSources += 1
      continue
    }
    const source = {
      addonId: outcome.value.catalog.addon.id,
      addonName: outcome.value.catalog.addon.manifest.name,
      catalogId: outcome.value.catalog.id,
      catalogName:
        outcome.value.catalog.addon.manifest.catalogs.find(
          (catalog) =>
            catalog.id === outcome.value.catalog.id && catalog.type === outcome.value.catalog.type,
        )?.name ?? outcome.value.catalog.id,
      type: outcome.value.catalog.type,
    }
    for (const item of outcome.value.items) {
      const key = `${item.type}:${item.id}`
      const existing = merged.get(key)
      if (existing) {
        existing.sources.push(source)
      } else {
        merged.set(key, { ...item, sources: [source] })
      }
    }
  }

  return {
    results: [...merged.values()],
    failedSources,
    totalSources: catalogs.length,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error("add-on search timed out")),
      timeoutMs,
    )
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
