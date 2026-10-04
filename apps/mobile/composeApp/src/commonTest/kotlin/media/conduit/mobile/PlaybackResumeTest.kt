package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.foundation.ResumeBehavior

class PlaybackResumeTest {
    @Test
    fun playbackStartPositionResetsWatchedOrEndpointProgress() {
        assertEquals(0L, playbackStartPosition(progress(positionMs = 600_000, durationMs = 600_000)))
        assertEquals(0L, playbackStartPosition(progress(positionMs = 650_000, durationMs = 600_000)))
        assertEquals(0L, playbackStartPosition(progress(positionMs = 600_000, durationMs = 600_000, watched = true)))
        assertEquals(125_000L, playbackStartPosition(progress(positionMs = 125_000, durationMs = 600_000)))
        assertEquals(0L, playbackStartPosition(null))
    }

    @Test
    fun freshPlaybackUsesTheSelectedPolicy() {
        val position = 125_000L
        assertEquals(PlaybackResumeDecision.Ask(position), playbackResumeDecision(ResumeBehavior.Ask, position))
        assertEquals(PlaybackResumeDecision.Start(position), playbackResumeDecision(ResumeBehavior.Always, position))
        assertEquals(PlaybackResumeDecision.Start(0), playbackResumeDecision(ResumeBehavior.Restart, position))
        assertEquals(PlaybackResumeDecision.Start(0), playbackResumeDecision(ResumeBehavior.Ask, 0))
    }

    @Test
    fun explicitActionsAndExistingPlaybackOverrideThePolicy() {
        for (behavior in ResumeBehavior.entries) {
            assertEquals(PlaybackResumeDecision.Start(0), playbackResumeDecision(behavior, 125_000, explicitPositionMs = 0))
            assertEquals(PlaybackResumeDecision.Start(125_000), playbackResumeDecision(behavior, 125_000, explicitPositionMs = 125_000))
            assertEquals(PlaybackResumeDecision.Start(42_000), playbackResumeDecision(behavior, 125_000, retainedPositionMs = 42_000))
        }
    }

    private fun progress(
        positionMs: Long,
        durationMs: Long,
        watched: Boolean = false,
    ) = ProgressSummary(
        videoId = "episode-2",
        mediaType = "series",
        mediaId = "show-1",
        name = "Show",
        positionMs = positionMs,
        durationMs = durationMs,
        watched = watched,
        updatedAt = "2026-08-25T00:00:00Z",
    )
}
