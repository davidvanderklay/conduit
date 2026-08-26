package media.conduit.client

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DesktopPlayerOverlayTest {
    @Test
    fun scaledControlsKeepSeekAndVolumeAtTheirPaintedEndpoints() {
        val layout = desktopPlayerOverlayGeometry(width = 2048, height = 1152, hasNextEpisode = true)

        assertEquals(0f, desktopPlayerOverlaySeekFraction(2048, 1152, layout.progressLeft))
        assertEquals(1f, desktopPlayerOverlaySeekFraction(2048, 1152, layout.progressRight))
        assertEquals(0f, desktopPlayerOverlayVolumeFraction(2048, 1152, true, layout.volumeLeft))
        assertEquals(1f, desktopPlayerOverlayVolumeFraction(2048, 1152, true, layout.volumeRight))
        assertTrue(layout.volumeLeft > layout.muteRight)
        assertTrue(layout.progressRight > layout.progressLeft)
    }

    @Test
    fun volumeAndSeekClampOutsideTheTrack() {
        assertEquals(0f, desktopPlayerOverlaySeekFraction(1280, 720, -100))
        assertEquals(1f, desktopPlayerOverlaySeekFraction(1280, 720, 10_000))
        assertEquals(0f, desktopPlayerOverlayVolumeFraction(1280, 720, false, -100))
        assertEquals(1f, desktopPlayerOverlayVolumeFraction(1280, 720, false, 10_000))
    }
}
