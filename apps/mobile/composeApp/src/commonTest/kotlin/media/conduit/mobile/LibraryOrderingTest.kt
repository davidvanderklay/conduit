package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.account.LibraryItemSummary
import media.conduit.mobile.account.ProgressSummary

class LibraryOrderingTest {
    private val movie = item("movie", "movie", "Movie")
    private val completeSeries = item("complete", "series", "Complete")
    private val partialSeries = item("partial", "series", "Partial")
    private val untouchedSeries = item("untouched", "series", "Untouched")
    private val items = listOf(movie, completeSeries, partialSeries, untouchedSeries)
    private val progress = listOf(
        progress("movie", "movie", type = "movie", watched = true, updatedAt = "2026-01-04"),
        progress("complete:1", "complete", watched = true, updatedAt = "2026-01-03"),
        progress("partial:1", "partial", watched = true, updatedAt = "2026-01-02"),
        progress("partial:2", "partial", position = 50, updatedAt = "2026-01-01"),
    )
    private val episodeIds = mapOf(
        "complete" to listOf("complete:1"),
        "partial" to listOf("partial:1", "partial:2"),
    )

    @Test
    fun watchedPutsOnlyCompleteTitlesFirst() {
        assertEquals(
            listOf("movie", "complete", "partial", "untouched"),
            orderLibraryItems(items, progress, LibrarySort.Watched) { episodeIds[it.id].orEmpty() }.map { it.id },
        )
    }

    @Test
    fun nameSortsInBothDirections() {
        assertEquals(
            listOf("complete", "movie", "partial", "untouched"),
            orderLibraryItems(items, progress, LibrarySort.Name).map { it.id },
        )
        assertEquals(
            listOf("untouched", "partial", "movie", "complete"),
            orderLibraryItems(items, progress, LibrarySort.NameDescending).map { it.id },
        )
    }

    @Test
    fun lastWatchedPutsRecentProgressBeforeUntouchedTitles() {
        assertEquals(
            listOf("movie", "complete", "partial", "untouched"),
            orderLibraryItems(items, progress, LibrarySort.LastWatched).map { it.id },
        )
    }

    @Test
    fun notWatchedIncludesPartialAndUntouchedTitles() {
        assertEquals(
            listOf("partial", "untouched", "movie", "complete"),
            orderLibraryItems(items, progress, LibrarySort.NotWatched) { episodeIds[it.id].orEmpty() }.map { it.id },
        )
    }

    private fun item(id: String, type: String, name: String) =
        LibraryItemSummary(id, type, name, updatedAt = "2025-01-01")

    private fun progress(
        videoId: String,
        mediaId: String,
        type: String = "series",
        watched: Boolean = false,
        position: Long = 0,
        updatedAt: String,
    ) = ProgressSummary(
        videoId = videoId,
        mediaType = type,
        mediaId = mediaId,
        name = mediaId,
        positionMs = position,
        durationMs = 100,
        watched = watched,
        updatedAt = updatedAt,
    )
}
