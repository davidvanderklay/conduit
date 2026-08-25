package media.conduit.client

import media.conduit.client.account.LibraryItemSummary
import media.conduit.client.account.ProgressSummary

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
    val latestProgress = progress
        .filterNot { it.videoId.startsWith("conduit:completion:") }
        .groupBy { "${it.mediaType}:${it.mediaId}" }
        .mapValues { (_, entries) -> entries.maxBy(ProgressSummary::updatedAt) }

    val lastWatched = compareByDescending<LibraryItemSummary> {
        latestProgress["${it.type}:${it.id}"]?.updatedAt ?: ""
    }.thenByDescending(LibraryItemSummary::updatedAt)
        .thenBy { it.name.lowercase() }
        .thenBy(LibraryItemSummary::id)

    return when (sort) {
        LibrarySort.LastWatched -> items.sortedWith(lastWatched)
        LibrarySort.Name -> items.sortedWith(compareBy<LibraryItemSummary> { it.name.lowercase() }.thenBy(LibraryItemSummary::id))
        LibrarySort.NameDescending -> items.sortedWith(compareByDescending<LibraryItemSummary> { it.name.lowercase() }.thenBy(LibraryItemSummary::id))
        LibrarySort.Watched,
        LibrarySort.NotWatched,
        -> {
            val complete = items.associate { item ->
                val state = posterWatchState(progress, item.asCatalogItem(), episodeIds(item))
                "${item.type}:${item.id}" to (state == PosterWatchState.Complete)
            }
            items.sortedWith(
                compareBy<LibraryItemSummary> { item ->
                    val watched = complete["${item.type}:${item.id}"] == true
                    when (sort) {
                        LibrarySort.Watched -> if (watched) 0 else 1
                        LibrarySort.NotWatched -> if (watched) 1 else 0
                        LibrarySort.LastWatched,
                        LibrarySort.Name,
                        LibrarySort.NameDescending,
                        -> error("Status ordering requires a status sort")
                    }
                }.then(lastWatched),
            )
        }
    }
}
