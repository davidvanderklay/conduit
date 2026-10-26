import type { HomeRowSetting, InstalledAddon } from "./api"
import { formatCatalogTitle } from "./catalog-title"
import { coreValue } from "./core"

/** A catalog an enabled add-on can show on Home. */
export interface HomeCatalogSource {
  /** Stable across reinstalls and imports, unlike the installation id. */
  key: string
  title: string
  addonId: string
  addonName: string
  manifestUrl: string
  type: string
  catalogId: string
}

export type HomeRow = HomeCatalogSource & { defaultTitle: string; enabled: boolean }

/** Home catalogs in add-on order. A second install of the same add-on repeats the first one's rows, so it is skipped. */
export function homeCatalogSources(addons: InstalledAddon[]): HomeCatalogSource[] {
  const seen = new Set<string>()
  return addons
    .filter((addon) => addon.enabled)
    .flatMap((addon) =>
      addon.manifest.catalogs
        .filter((catalog) => !(catalog.extra ?? []).some((extra) => extra.isRequired))
        .map((catalog) => ({
          key: `${addon.manifestId}:${catalog.type}:${catalog.id}`,
          title: formatCatalogTitle(
            catalog.name ?? `${addon.manifest.name} · ${catalog.id}`,
            catalog.type,
          ),
          addonId: addon.id,
          addonName: addon.manifest.name,
          manifestUrl: addon.manifestUrl,
          type: catalog.type,
          catalogId: catalog.id,
        })),
    )
    .filter((catalog) => {
      if (seen.has(catalog.key)) return false
      seen.add(catalog.key)
      return true
    })
}

/** Every home catalog with the profile's saved order, titles, and visibility applied. */
export function arrangeHomeRows(
  addons: InstalledAddon[],
  settings: HomeRowSetting[] = [],
): HomeRow[] {
  return coreValue<HomeRow[]>({
    type: "arrangeHomeRows",
    catalogs: homeCatalogSources(addons),
    settings,
  })
}

/** Settings to save for edited rows. Choices for catalogs that are unavailable right now, such as a disabled add-on's, are kept. */
export function homeRowSettings(
  rows: HomeRow[],
  previous: HomeRowSetting[] = [],
): HomeRowSetting[] {
  const keys = new Set(rows.map((row) => row.key))
  return [
    ...rows.map(({ key, enabled, title, defaultTitle }) => {
      const custom = title.trim()
      return { key, enabled, ...(custom && custom !== defaultTitle ? { title: custom } : {}) }
    }),
    ...previous.filter((setting) => !keys.has(setting.key)),
  ]
}
