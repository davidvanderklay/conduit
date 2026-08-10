package media.conduit.mobile.account

fun mediaTypeLabel(type: String): String {
    val normalized = type.trim().lowercase()
    return when (normalized) {
        "movie" -> "Movie"
        "series" -> "Series"
        else -> normalized.replaceFirstChar { it.uppercase() }.ifBlank { "Catalog" }
    }
}

fun formatCatalogTitle(title: String, type: String): String {
    val trimmed = title.trim()
    val label = mediaTypeLabel(type)
    if (trimmed.isBlank() || trimmed.equals(label, ignoreCase = true)) return label
    if (trimmed.endsWith(" - $label", ignoreCase = true)) return trimmed
    return "$trimmed - $label"
}
