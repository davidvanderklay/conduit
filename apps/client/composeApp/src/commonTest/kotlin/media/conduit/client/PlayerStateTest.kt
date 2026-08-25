package media.conduit.client

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlayerStateTest {
    @Test
    fun pipRequiresPlatformSupportAndAReadyTimeline() {
        val ready = PlaybackState(loading = false, durationMs = 120_000, pipReady = true)

        assertTrue(isSystemPipActionReady(systemPipAvailable = true, playback = ready))
        assertFalse(isSystemPipActionReady(systemPipAvailable = false, playback = ready))
        assertFalse(isSystemPipActionReady(systemPipAvailable = true, playback = ready.copy(pipReady = false)))
        assertFalse(isSystemPipActionReady(systemPipAvailable = true, playback = ready.copy(loading = true)))
        assertFalse(isSystemPipActionReady(systemPipAvailable = true, playback = ready.copy(error = "failed")))
    }

    @Test
    fun centerPlaybackControlHidesDuringSeekBufferingAndSystemPip() {
        assertTrue(shouldShowCenterPlaybackControl(controlsVisible = true, seeking = false, buffering = false))
        assertFalse(shouldShowCenterPlaybackControl(controlsVisible = true, seeking = true, buffering = false))
        assertFalse(shouldShowCenterPlaybackControl(controlsVisible = true, seeking = false, buffering = true))
        assertFalse(shouldShowCenterPlaybackControl(controlsVisible = true, seeking = false, buffering = false, systemPip = true))
        assertFalse(shouldShowCenterPlaybackControl(controlsVisible = false, seeking = false, buffering = false))
    }
}
