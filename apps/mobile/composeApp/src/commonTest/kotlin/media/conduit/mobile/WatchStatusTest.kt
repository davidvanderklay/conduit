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

    @Test
    fun episodeStateAndProgressUseExplicitWatchedFlag() {
        assertEquals(EpisodeWatchState.NotStarted, episodeWatchState(null))
        val partial = progress("partial", "show", position = 25).copy(durationMs = 100_000)
        assertEquals(EpisodeWatchState.InProgress, episodeWatchState(partial))
        assertEquals(.25f, episodeProgressFraction(partial))
        assertEquals(EpisodeWatchState.Watched, episodeWatchState(partial.copy(watched = true)))
        assertEquals(0f, episodeProgressFraction(partial.copy(watched = true)))
    }

    @Test
    fun restOfSeasonStartsAtCurrentEpisodeAndSkipsUnavailableEpisodes() {
        val videos = listOf(
            VideoItem("s1e1", season = 1, episode = 1, released = "2026-01-01"),
            VideoItem("s1e2", season = 1, episode = 2, released = "2026-01-01"),
            VideoItem("future", season = 1, episode = 3, released = "2027-01-01"),
            VideoItem("s2e1", season = 2, episode = 1, released = "2026-01-01"),
        )

        assertEquals(
            listOf("s1e2"),
            restOfSeasonWatchVideos(videos, 1, "s1e2", today = "2026-06-01").map(VideoItem::id),
        )
    }

    @Test
    fun detailsResumeUnfinishedMovies() {
        val movie = CatalogItem("movie", "movie", "Movie")
        val unfinished = progress("movie", "movie", position = 30_000, type = "movie")

        assertEquals(unfinished, latestUnfinishedProgress(listOf(unfinished), movie))
        assertEquals("Resume", detailsPlayLabel(movie, unfinished, null))
        assertEquals("Play", detailsPlayLabel(movie, unfinished.copy(watched = true), null))
    }

    @Test
    fun detailsResumeSeriesWithEpisodeNumber() {
        val series = CatalogItem("show", "series", "Show")
        val unfinished = progress("s1e2", "show", position = 30_000)
        val episode = VideoItem("s1e2", season = 1, episode = 2)

        assertEquals(unfinished, latestUnfinishedProgress(listOf(unfinished), series))
        assertEquals("Resume S1E2", detailsPlayLabel(series, unfinished, episode))
        assertEquals("Play", detailsPlayLabel(series, unfinished, VideoItem("s1e3", season = 1, episode = 3)))
    }

    @Test
    fun zeroProgressDoesNotOfferResume() {
        val movie = CatalogItem("movie", "movie", "Movie")
        val notStarted = progress("movie", "movie", position = 0, type = "movie")

        assertEquals(null, latestUnfinishedProgress(listOf(notStarted), movie))
        assertEquals("Play", detailsPlayLabel(movie, null, null))
    }

    @Test
    fun explicitHistoryEpisodeWinsAndMissingEpisodeFallsBackToLatestUnfinished() {
        val series = CatalogItem("show", "series", "Show")
        val unfinished = progress("s1e2", "show", position = 30_000)

        assertEquals("s1e3", effectiveResumeVideoId("s1e3", listOf(unfinished), series))
        assertEquals("s1e2", effectiveResumeVideoId(null, listOf(unfinished), series))
    }

    private fun progress(videoId: String, mediaId: String, watched: Boolean = false, position: Long = 0, type: String = "series") =
        ProgressSummary(videoId, type, mediaId, "Title", positionMs = position, durationMs = 100_000, watched = watched, updatedAt = "2026-01-01")
}
