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
}
