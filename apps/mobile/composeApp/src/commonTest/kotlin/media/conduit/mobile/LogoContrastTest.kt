package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LogoContrastTest {
    /** An 8x8 logo with opaque [color] rows from [top] to [bottom] inclusive. */
    private fun logo(color: Int, top: Int = 0, bottom: Int = 7) =
        IntArray(64) { index -> if (index / 8 in top..bottom) color else 0x00000000 }

    private fun analyze(pixels: IntArray) = analyzeLogoPixels(pixels, width = 8, height = 8)

    @Test
    fun navyLogoIsDark() = assertTrue(analyze(logo(0xFF2E3D58.toInt())).dark)

    @Test
    fun saturatedRedLogoIsReadable() = assertFalse(analyze(logo(0xFFE3262F.toInt())).dark)

    @Test
    fun transparentPaddingIsMeasured() {
        val analysis = analyze(logo(0xFFFFFFFF.toInt(), top = 2, bottom = 5))
        assertEquals(2 / 8f, analysis.topInset)
        assertEquals(2 / 8f, analysis.bottomInset)
    }

    @Test
    fun nearlyEmptyImagesAreLeftAlone() = assertEquals(LogoAnalysis(false, 0f, 0f), analyze(IntArray(64)))
}
