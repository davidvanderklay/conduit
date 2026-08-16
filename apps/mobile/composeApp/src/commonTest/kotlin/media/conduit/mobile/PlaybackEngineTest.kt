package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlaybackEngineTest {
    @Test
    fun automaticMedia3CanFallbackOnce() {
        assertTrue(canFallbackToLibmpv(AndroidPlaybackEngine.Automatic, NativePlaybackEngine.Media3, false))
        assertFalse(canFallbackToLibmpv(AndroidPlaybackEngine.Automatic, NativePlaybackEngine.Media3, true))

        val fallback = beginLibmpvFallback(
            PlaybackEngineSession(AndroidPlaybackEngine.Automatic, NativePlaybackEngine.Media3),
            "decoder failed",
        )
        assertEquals(NativePlaybackEngine.Libmpv, fallback?.activeEngine)
        assertEquals("decoder failed", fallback?.fallbackReason)
    }

    @Test
    fun manualModesNeverFallback() {
        assertFalse(canFallbackToLibmpv(AndroidPlaybackEngine.Media3, NativePlaybackEngine.Media3, false))
        assertFalse(canFallbackToLibmpv(AndroidPlaybackEngine.Libmpv, NativePlaybackEngine.Media3, false))
        assertFalse(canFallbackToLibmpv(AndroidPlaybackEngine.Automatic, NativePlaybackEngine.Libmpv, false))
    }

    @Test
    fun fallbackPositionKeepsTheFurthestKnownPosition() {
        assertEquals(42_000L, fallbackPositionMs(42_000L, 10_000L))
        assertEquals(42_000L, fallbackPositionMs(10_000L, 42_000L))
        assertEquals(0L, fallbackPositionMs(-1L, -4L))
    }

    @Test
    fun automaticRetryResetsTheFallbackAttemptForMedia3() {
        val session = PlaybackEngineSession(
            preference = AndroidPlaybackEngine.Automatic,
            activeEngine = NativePlaybackEngine.Libmpv,
            fallbackAttempted = true,
            fallbackReason = "Media3 failed",
        )

        val retry = retryPlaybackEngine(session)

        assertEquals(NativePlaybackEngine.Media3, retry.activeEngine)
        assertFalse(retry.fallbackAttempted)
        assertEquals(null, retry.fallbackReason)
    }

    @Test
    fun manualLibmpvRetryStaysOnLibmpv() {
        val session = PlaybackEngineSession(
            preference = AndroidPlaybackEngine.Libmpv,
            activeEngine = NativePlaybackEngine.Libmpv,
        )

        assertEquals(session, retryPlaybackEngine(session))
    }

    @Test
    fun combinedErrorKeepsBothEngineFailures() {
        assertEquals(
            "Media3 failed: decoder failed\nlibmpv failed: unsupported stream",
            combinedPlaybackError("decoder failed", "unsupported stream"),
        )
        assertEquals("unsupported stream", combinedPlaybackError(null, "unsupported stream"))
    }

    @Test
    fun startupTimeoutOnlyFallsBackWhenTheAttemptIsStillWaitingForAFrame() {
        assertFalse(shouldFallbackAfterStartup(9_999L, false, false))
        assertTrue(shouldFallbackAfterStartup(10_000L, false, false))
        assertFalse(shouldFallbackAfterStartup(10_000L, true, false))
        assertFalse(shouldFallbackAfterStartup(10_000L, false, true))
    }
}
