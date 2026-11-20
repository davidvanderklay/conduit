package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LogoContrastTest {
    private fun logo(color: Int, opaque: Int = 64) =
        IntArray(128) { if (it < opaque) color else 0x00000000 }

    @Test
    fun navyLogoIsDark() = assertTrue(isDarkLogoPixels(logo(0xFF2E3D58.toInt())))

    @Test
    fun saturatedRedLogoIsReadable() = assertFalse(isDarkLogoPixels(logo(0xFFE3262F.toInt())))

    @Test
    fun transparentPixelsAreIgnored() = assertFalse(isDarkLogoPixels(logo(0xFF101010.toInt(), opaque = 4)))
}
