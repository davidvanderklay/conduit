package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

class WatchStatusTest {
    @Test
    fun moviesUseBinaryCompletion() {
        val movie = CatalogItem("movie", "movie", "Movie")
        assertEquals(PosterWatchState.Unwatched, posterWatchState(emptyList(), movie))
        assertEquals(PosterWatchState.Complete, posterWatchState(listOf(progress("movie", "movie", watched = true, type = "movie")), movie))
    }

    @Test
    fun seriesDistinguishPartialAndComplete() {
        val series = CatalogItem("show", "series", "Show")
        assertEquals(PosterWatchState.Partial, posterWatchState(listOf(progress("s1e1", "show", position = 30_000)), series, listOf("s1e1", "s1e2")))
        assertEquals(PosterWatchState.Complete, posterWatchState(listOf(progress("s1e1", "show", watched = true), progress("s1e2", "show", watched = true)), series, listOf("s1e1", "s1e2")))
    }

    @Test
    fun completionExcludesSpecialsAndFutureEpisodes() {
        assertEquals(
            listOf("regular"),
            completionEpisodeIds(
                listOf(
                    VideoItem("regular", season = 1, episode = 1, released = "2026-01-01"),
                    VideoItem("special", season = 0, episode = 1),
                    VideoItem("unavailable", season = 1, episode = 2, available = false),
                    VideoItem("future", season = 1, episode = 2, released = "2027-01-01"),
                ),
                today = "2026-06-01",
            ),
        )
    }

    private fun progress(videoId: String, mediaId: String, watched: Boolean = false, position: Long = 0, type: String = "series") =
        ProgressSummary(videoId, type, mediaId, "Title", positionMs = position, durationMs = 100_000, watched = watched, updatedAt = "2026-01-01")
}
