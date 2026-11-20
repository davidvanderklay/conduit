/** Display label for a media type as a collection ("Movies", "Series"), shared by shelves and search. */
export function mediaTypeLabel(type: string): string {
  const normalized = type.trim().toLowerCase()
  if (normalized === "movie") return "Movies"
  if (normalized === "series") return "Series"
  return normalized ? normalized.replace(/^[a-z]/, (letter) => letter.toUpperCase()) : "Catalog"
}

export function formatCatalogTitle(title: string, type: string): string {
  const trimmed = title.trim()
  const label = mediaTypeLabel(type)
  const lower = trimmed.toLowerCase()
  // Addons often bake the type in already, singular or plural, with their own separator.
  const names = [label, type.trim()].map((name) => name.toLowerCase())
  if (!trimmed || names.includes(lower)) return label
  for (const separator of [" - ", " · "]) {
    for (const name of names) {
      const suffix = `${separator}${name}`
      if (lower.endsWith(suffix)) return `${trimmed.slice(0, -suffix.length)} · ${label}`
    }
  }
  return `${trimmed} · ${label}`
}
