export function mediaTypeLabel(type: string): string {
  const normalized = type.trim().toLowerCase()
  if (normalized === "movie") return "Movie"
  if (normalized === "series") return "Series"
  return normalized ? normalized.replace(/^[a-z]/, (letter) => letter.toUpperCase()) : "Catalog"
}

export function formatCatalogTitle(title: string, type: string): string {
  const trimmed = title.trim()
  const label = mediaTypeLabel(type)
  if (!trimmed || trimmed.toLowerCase() === label.toLowerCase()) return label
  if (trimmed.toLowerCase().endsWith(` - ${label.toLowerCase()}`)) return trimmed
  return `${trimmed} - ${label}`
}
