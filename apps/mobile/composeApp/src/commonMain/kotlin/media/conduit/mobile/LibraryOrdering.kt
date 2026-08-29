package media.conduit.mobile

import media.conduit.mobile.account.LibraryItemSummary
import media.conduit.mobile.account.ProgressSummary
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

internal enum class LibrarySort(val label: String) {
    LastWatched("By last watched"),
    Name("By name"),
    NameDescending("By name descending"),
    Watched("By watched"),
    NotWatched("By not watched"),
}

internal fun orderLibraryItems(
    items: List<LibraryItemSummary>,
    progress: List<ProgressSummary>,
    sort: LibrarySort,
    episodeIds: (LibraryItemSummary) -> List<String> = { emptyList() },
): List<LibraryItemSummary> {
    val episodes = items.associate { item -> "${item.type}:${item.id}" to episodeIds(item) }
    val coreSort = when (sort) {
        LibrarySort.LastWatched -> "last-watched"
        LibrarySort.Name -> "name"
        LibrarySort.NameDescending -> "name-desc"
        LibrarySort.Watched -> "watched"
        LibrarySort.NotWatched -> "not-watched"
    }
    return coreValue(buildJsonObject {
        put("type", "orderLibrary")
        put("items", ProtocolJson.encodeToJsonElement(items))
        put("progress", ProtocolJson.encodeToJsonElement(progress))
        put("sort", coreSort)
        put("episodeIds", ProtocolJson.encodeToJsonElement(episodes))
    }).jsonArray.mapNotNull { index -> items.getOrNull(index.jsonPrimitive.content.toInt()) }
}
