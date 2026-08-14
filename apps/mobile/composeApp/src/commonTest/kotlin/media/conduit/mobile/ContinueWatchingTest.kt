package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Instant
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

class ContinueWatchingTest {
    private val videos = listOf(
        VideoItem("special", season = 0, episode = 1),
        VideoItem("s1e2", season = 1, episode = 2, thumbnail = "episode-2.jpg"),
        VideoItem("s1e3", season = 1, episode = 3, released = "2026-08-11T10:00:00Z"),
        VideoItem("s1e4", season = 1, episode = 4, released = "2026-08-13T10:00:00Z"),
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
            continueWatchingPresentation(
                progress(),
                videos,
                today = "2026-08-12",
                now = Instant.parse("2026-08-12T12:00:00Z"),
            ),
        )
    }

    @Test
    fun oldGapsDoNotAffectTheCaughtUpDecision() {
        val withGap = listOf(VideoItem("s1e1", season = 1, episode = 1)) + videos
        assertEquals(
            ContinueWatchingKind.NewEpisode,
            continueWatchingPresentation(
                progress(),
                withGap,
                today = "2026-08-12",
                now = Instant.parse("2026-08-12T12:00:00Z"),
            ).kind,
        )
    }

    @Test
    fun knownFutureEpisodeUsesRelativeDateThenCaughtUpFallback() {
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.Scheduled, videos[3], "Tomorrow"),
            continueWatchingPresentation(
                progress(videoId = "s1e3", episode = 3),
                videos,
                today = "2026-08-12",
                now = Instant.parse("2026-08-12T12:00:00Z"),
            ),
        )
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.CaughtUp, videos[3]),
            continueWatchingPresentation(progress(videoId = "s1e4", episode = 4), videos, "2026-08-12"),
        )
    }

    @Test
    fun dateOnlyEpisodeCanTriggerNewEpisodeAlertAfterTheWatchedSeed() {
        val today = VideoItem("s1e3", season = 1, episode = 3, released = "2026-08-12")
        assertEquals(
            ContinueWatchingPresentation(ContinueWatchingKind.NewEpisode, today),
            continueWatchingPresentation(
                progress(),
                listOf(videos[1], today),
                today = "2026-08-12",
                now = Instant.parse("2026-08-12T12:00:00Z"),
            ),
        )
        assertEquals(
            ContinueWatchingKind.NewEpisode,
            continueWatchingPresentation(
                progress(),
                listOf(videos[1], today.copy(available = true)),
                today = "2026-08-12",
                now = Instant.parse("2026-08-12T12:00:00Z"),
            ).kind,
        )
    }

    @Test
    fun newEpisodeRequiresAiredReleaseAfterTheWatchedSeedWithinSixtyDays() {
        val release = VideoItem("s1e3", season = 1, episode = 3, released = "2026-08-12T09:00:00Z")
        val episodes = listOf(videos[1], release)
        val now = Instant.parse("2026-08-12T12:00:00Z")

        assertEquals(
            ContinueWatchingKind.NewEpisode,
            continueWatchingPresentation(progress(updatedAt = "2026-08-11T12:00:00Z"), episodes, "2026-08-12", now).kind,
        )
        assertEquals(
            ContinueWatchingKind.NextUp,
            continueWatchingPresentation(progress(updatedAt = "2026-08-12T10:00:00Z"), episodes, "2026-08-12", now).kind,
        )
        assertEquals(
            ContinueWatchingKind.NextUp,
            continueWatchingPresentation(
                progress(updatedAt = "2026-06-01T12:00:00Z"),
                episodes,
                today = "2026-08-12",
                now = Instant.parse("2026-10-20T12:00:00Z"),
            ).kind,
        )
    }

    @Test
    fun continueWatchingBadgeAlwaysHasUsefulFallbackText() {
        val unfinished = progress(watched = false, positionMs = 30_000, durationMs = 60_000)
        val inProgress = continueWatchingPresentation(unfinished, emptyList())
        assertEquals("1 min left", continueWatchingBadgeLabel(unfinished, inProgress, metadataReady = false))
        assertEquals(
            "Next Up",
            continueWatchingBadgeLabel(progress(), ContinueWatchingPresentation(ContinueWatchingKind.CaughtUp), metadataReady = false),
        )
        val notStarted = progress(watched = false)
        val notStartedPresentation = continueWatchingPresentation(notStarted, emptyList())
        assertEquals("Next Up", continueWatchingBadgeLabel(notStarted, notStartedPresentation, metadataReady = false))
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
        updatedAt: String = "2026-08-10T12:00:00Z",
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
