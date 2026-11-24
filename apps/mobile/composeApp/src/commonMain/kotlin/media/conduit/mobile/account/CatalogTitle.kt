package media.conduit.mobile.account

fun mediaTypeLabel(type: String): String {
    val normalized = type.trim().lowercase()
    return when (normalized) {
        "movie" -> "Movie"
        "series" -> "Series"
        else -> normalized.replaceFirstChar { it.uppercase() }.ifBlank { "Catalog" }
    }
}

private fun mediaTypePluralLabel(type: String): String =
    if (type.trim().equals("movie", ignoreCase = true)) "Movies" else mediaTypeLabel(type)

/** Shelf title for a catalog, e.g. "Popular · Movies". Accepts legacy "Popular - Movie" titles. */
fun formatCatalogTitle(title: String, type: String): String {
    val label = mediaTypeLabel(type)
    val plural = mediaTypePluralLabel(type)
    val base = title.trim().removeSuffix(" - $label").removeSuffix(" · $plural").trim()
    if (base.isBlank() || base.equals(label, ignoreCase = true) || base.equals(plural, ignoreCase = true)) return plural
    return "$base · $plural"
}
