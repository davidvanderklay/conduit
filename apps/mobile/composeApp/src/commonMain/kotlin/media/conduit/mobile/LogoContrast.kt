package media.conduit.mobile

import coil3.compose.AsyncImagePainter

/**
 * True when a loaded title logo is too dark to read on Conduit's near-black hero.
 * Callers tint such logos white and keep bright logos in their own colors.
 */
internal expect fun AsyncImagePainter.State.Success.isDarkLogo(): Boolean

/** Judges ARGB pixels by the average brightness (max RGB channel) of the opaque ones. */
internal fun isDarkLogoPixels(pixels: IntArray): Boolean {
    var total = 0f
    var count = 0
    for (pixel in pixels) {
        if ((pixel ushr 24) and 0xFF < 160) continue
        total += maxOf((pixel shr 16) and 0xFF, (pixel shr 8) and 0xFF, pixel and 0xFF) / 255f
        count++
    }
    return count >= 24 && total / count < .5f
}
