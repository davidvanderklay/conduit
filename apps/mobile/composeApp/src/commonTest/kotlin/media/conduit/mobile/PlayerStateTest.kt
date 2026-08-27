package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
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

    @Test
    fun playerActionOverlaysStayAboveControlsWhenControlsChange() {
        assertEquals(
            COMPACT_PLAYER_ACTION_BOTTOM_PADDING_DP,
            playerActionBottomPaddingDp(controlsVisible = true, compactUpNext = true),
        )
        assertEquals(
            COMPACT_PLAYER_ACTION_BOTTOM_PADDING_DP,
            playerActionBottomPaddingDp(controlsVisible = false, compactUpNext = true),
        )
        assertEquals(
            PLAYER_ACTION_BOTTOM_PADDING_DP,
            playerActionBottomPaddingDp(controlsVisible = true, compactUpNext = false),
        )
        assertEquals(
            PLAYER_ACTION_BOTTOM_PADDING_DP,
            playerActionBottomPaddingDp(controlsVisible = false, compactUpNext = false),
        )
        assertEquals(
            TABLET_PLAYER_ACTION_BOTTOM_PADDING_DP,
            playerActionBottomPaddingDp(
                controlsVisible = true,
                compactUpNext = false,
                isTablet = true,
            ),
        )
    }

    @Test
    fun nativePlaybackWaitsForFirstVideoFrame() {
        assertFalse(canStartNativePlayback(active = true, playWhenReady = true, firstFrameRendered = false))
        assertTrue(canStartNativePlayback(active = true, playWhenReady = true, firstFrameRendered = true))
        assertFalse(canStartNativePlayback(active = false, playWhenReady = true, firstFrameRendered = true))
        assertFalse(canStartNativePlayback(active = true, playWhenReady = false, firstFrameRendered = true))
    }

    @Test
    fun inlinePlaybackIsHiddenOnlyForPlatformsThatKeepTheActivityVisibleInPip() {
        assertFalse(shouldHideInlinePlaybackForPip(systemPip = false, systemPipKeepsAppVisible = false))
        assertFalse(shouldHideInlinePlaybackForPip(systemPip = true, systemPipKeepsAppVisible = false))
        assertTrue(shouldHideInlinePlaybackForPip(systemPip = true, systemPipKeepsAppVisible = true))
    }

    @Test
    fun tabletPlaybackExitDoesNotRestorePortraitLock() {
        assertTrue(shouldRestorePortraitAfterPlayback(smallestWidthDp = 599))
        assertFalse(shouldRestorePortraitAfterPlayback(smallestWidthDp = 600))
    }

    @Test
    fun tabletMediaGridBecomesAdaptiveAtTabletWidth() {
        assertFalse(usesAdaptiveMediaGrid(windowWidthDp = 599))
        assertTrue(usesAdaptiveMediaGrid(windowWidthDp = 600))
    }
}
