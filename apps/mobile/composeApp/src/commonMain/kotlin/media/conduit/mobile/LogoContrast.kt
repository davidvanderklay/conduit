package media.conduit.mobile

import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import coil3.compose.AsyncImagePainter
import kotlin.math.roundToInt

/**
 * What a loaded title logo needs to sit well on Conduit's near-black hero: whether it is too dark to
 * read (callers tint it white), and how much fully transparent space pads its top and bottom (callers
 * trim it from layout so spacing is measured from the visible lettering).
 */
internal data class LogoAnalysis(val dark: Boolean, val topInset: Float, val bottomInset: Float)

internal expect fun AsyncImagePainter.State.Success.analyzeLogo(): LogoAnalysis

internal const val LogoSampleWidth = 128
internal const val LogoSampleHeight = 64

/** Analyzes a [LogoSampleWidth] x [LogoSampleHeight] ARGB sample of a logo. */
internal fun analyzeLogoPixels(pixels: IntArray, width: Int = LogoSampleWidth, height: Int = LogoSampleHeight): LogoAnalysis {
    var total = 0f
    var count = 0
    var firstRow = -1
    var lastRow = -1
    for (row in 0 until height) {
        for (column in 0 until width) {
            val pixel = pixels[row * width + column]
            if ((pixel ushr 24) and 0xFF < 160) continue
            total += maxOf((pixel shr 16) and 0xFF, (pixel shr 8) and 0xFF, pixel and 0xFF) / 255f
            count++
            if (firstRow < 0) firstRow = row
            lastRow = row
        }
    }
    if (count < 24) return LogoAnalysis(dark = false, topInset = 0f, bottomInset = 0f)
    return LogoAnalysis(
        dark = total / count < .5f,
        topInset = firstRow / height.toFloat(),
        bottomInset = (height - 1 - lastRow) / height.toFloat(),
    )
}

/**
 * Removes a logo's transparent top and bottom rows from layout, so spacing is measured from its lettering.
 * Apply it directly around the image's size modifiers; padding inside it would be trimmed as if it were image.
 */
internal fun Modifier.trimLogoInsets(analysis: LogoAnalysis?) = if (analysis == null) this else layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val top = (placeable.height * analysis.topInset).roundToInt()
    val bottom = (placeable.height * analysis.bottomInset).roundToInt()
    layout(placeable.width, (placeable.height - top - bottom).coerceAtLeast(0)) { placeable.place(0, -top) }
}
