package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

class ContinueWatchingTest {
    private val videos = listOf(
        VideoItem("special", season = 0, episode = 1),
        VideoItem("s1e2", season = 1, episode = 2, thumbnail = "episode-2.jpg"),
        VideoItem("s1e3", season = 1, episode = 3, released = "2026-08-11"),
        VideoItem("s1e4", season = 1, episode = 4, released = "2026-08-13"),
    )

    @Test
    fun groupsSeriesAroundOnlyTheLatestRow() {
        val grouped = groupContinueWatching(listOf(
            progress(videoId = "s1e1", updatedAt = "2026-08-10"),
            progress(videoId = "s1e2", updatedAt = "2026-08-12"),
            progress(videoId = "movie", mediaType = "movie", mediaId = "movie"),
        ))
        assertEquals(listOf("s1e2", "movie"), grouped.map(ProgressSummary::videoId))
    }

    @Test
    fun unfinishedEpisodeUsesItsOwnArtwork() {
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.InProgress, videos[1]),
            continueWatchingPresentation(progress(watched = false), videos, "2026-08-12"),
        )
    }

    @Test
    fun completedAnchorPromotesTheFirstReleasedEpisodeAfterIt() {
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.NewEpisode, videos[2]),
            continueWatchingPresentation(progress(), videos, "2026-08-12"),
        )
    }

    @Test
    fun oldGapsDoNotAffectTheCaughtUpDecision() {
        val withGap = listOf(VideoItem("s1e1", season = 1, episode = 1)) + videos
        assertEquals(
            ContinueWatchingKind.NewEpisode,
            continueWatchingPresentation(progress(), withGap, "2026-08-12").kind,
        )
    }

    @Test
    fun knownFutureEpisodeUsesRelativeDateThenCaughtUpFallback() {
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.Scheduled, videos[3], "Tomorrow"),
            continueWatchingPresentation(progress(videoId = "s1e3", episode = 3), videos, "2026-08-12"),
        )
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.CaughtUp, videos[3]),
            continueWatchingPresentation(progress(videoId = "s1e4", episode = 4), videos, "2026-08-12"),
        )
    }

    @Test
    fun dateOnlyEpisodeStaysScheduledForTodayUntilAvailabilityIsKnown() {
        val today = VideoItem("s1e3", season = 1, episode = 3, released = "2026-08-12")
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.Scheduled, today, "Today"),
            continueWatchingPresentation(progress(), listOf(videos[1], today), "2026-08-12"),
        )
        assertEquals(
            ContinueWatchingKind.NewEpisode,
            continueWatchingPresentation(progress(), listOf(videos[1], today.copy(available = true)), "2026-08-12").kind,
        )
    }

    @Test
    fun formatsRemainingTimeAndReleaseDates() {
        assertEquals("1 min left", remainingTimeLabel(progress(watched = false, positionMs = 30_000, durationMs = 60_000)))
        assertEquals("1h 24m left", remainingTimeLabel(progress(watched = false, durationMs = 84 * 60_000)))
        assertEquals("Today", releaseDateLabel("2026-08-12", "2026-08-12"))
        assertEquals("Tomorrow", releaseDateLabel("2026-08-13", "2026-08-12"))
        assertEquals("Aug 19", releaseDateLabel("2026-08-19", "2026-08-12"))
    }

    private fun progress(
        videoId: String = "s1e2",
        mediaType: String = "series",
        mediaId: String = "show",
        episode: Int = 2,
        watched: Boolean = true,
        positionMs: Long = 0,
        durationMs: Long = 24 * 60_000,
        updatedAt: String = "2026-08-12",
    ) = ProgressSummary(
        videoId = videoId,
        mediaType = mediaType,
        mediaId = mediaId,
        name = "Show",
        season = if (mediaType == "series") 1 else null,
        episode = if (mediaType == "series") episode else null,
        positionMs = positionMs,
        durationMs = durationMs,
        watched = watched,
        updatedAt = updatedAt,
    )
}
