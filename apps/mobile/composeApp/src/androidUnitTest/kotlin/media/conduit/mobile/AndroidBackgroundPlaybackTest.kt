package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidBackgroundPlaybackTest {
    @Test
    fun activeNowPlayingSessionKeepsPlaybackRunning() {
        assertFalse(
            shouldPauseAndroidPlaybackOnStop(
                isInPictureInPicture = false,
                activityIsFinishing = false,
                hasActiveNowPlayingSession = true,
            ),
        )
    }

    @Test
    fun backgroundWithoutNowPlayingPauses() {
        assertTrue(
            shouldPauseAndroidPlaybackOnStop(
                isInPictureInPicture = false,
                activityIsFinishing = false,
                hasActiveNowPlayingSession = false,
            ),
        )
    }

    @Test
    fun finishingActivityAlwaysPauses() {
        assertTrue(
            shouldPauseAndroidPlaybackOnStop(
                isInPictureInPicture = true,
                activityIsFinishing = true,
                hasActiveNowPlayingSession = true,
            ),
        )
    }
}
