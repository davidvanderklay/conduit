package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.account.ProgressSummary

class PlaybackResumeTest {
    @Test
    fun playbackStartPositionResetsWatchedOrEndpointProgress() {
        assertEquals(0L, playbackStartPosition(progress(positionMs = 600_000, durationMs = 600_000)))
        assertEquals(0L, playbackStartPosition(progress(positionMs = 650_000, durationMs = 600_000)))
        assertEquals(0L, playbackStartPosition(progress(positionMs = 600_000, durationMs = 600_000, watched = true)))
        assertEquals(125_000L, playbackStartPosition(progress(positionMs = 125_000, durationMs = 600_000)))
        assertEquals(0L, playbackStartPosition(null))
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
