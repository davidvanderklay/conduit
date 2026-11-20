package media.conduit.mobile

import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImagePainter
import kotlin.math.roundToInt

/**
 * What a loaded title logo needs to sit well on Conduit's near-black hero: whether it is too dark to
 * read (callers tint it white), how much fully transparent space pads each edge (callers trim it so
 * spacing and size follow the visible lettering), and the source image's aspect ratio.
 */
internal data class LogoAnalysis(
    val dark: Boolean,
    val topInset: Float,
    val bottomInset: Float,
    val leftInset: Float = 0f,
    val rightInset: Float = 0f,
    val aspect: Float = 0f,
)

internal expect fun AsyncImagePainter.State.Success.analyzeLogo(): LogoAnalysis

internal const val LogoSampleWidth = 128
internal const val LogoSampleHeight = 64

/** Analyzes a [width] x [height] ARGB sample of a logo whose source aspect ratio is [aspect]. */
internal fun analyzeLogoPixels(
    pixels: IntArray,
    width: Int = LogoSampleWidth,
    height: Int = LogoSampleHeight,
    aspect: Float = 0f,
): LogoAnalysis {
    var total = 0f
    var count = 0
    var firstRow = -1
    var lastRow = -1
    var firstColumn = width
    var lastColumn = -1
    for (row in 0 until height) {
        for (column in 0 until width) {
            val pixel = pixels[row * width + column]
            if ((pixel ushr 24) and 0xFF < 160) continue
            total += maxOf((pixel shr 16) and 0xFF, (pixel shr 8) and 0xFF, pixel and 0xFF) / 255f
            count++
            if (firstRow < 0) firstRow = row
            lastRow = row
            firstColumn = minOf(firstColumn, column)
            lastColumn = maxOf(lastColumn, column)
        }
    }
    if (count < 24) return LogoAnalysis(dark = false, topInset = 0f, bottomInset = 0f)
    return LogoAnalysis(
        dark = total / count < .5f,
        topInset = firstRow / height.toFloat(),
        bottomInset = (height - 1 - lastRow) / height.toFloat(),
        leftInset = firstColumn / width.toFloat(),
        rightInset = (width - 1 - lastColumn) / width.toFloat(),
        aspect = aspect,
    )
}

/**
 * Sizes a title logo: [widthFraction] of the available width, at most [maxHeight] tall, locked to the
 * image's aspect ratio once known, with transparent margins cropped out of layout. Because the box
 * always matches the image, cropping the side margins lets wide-padded logos grow without cutting
 * any lettering, and spacing follows the visible lettering.
 */
internal fun Modifier.logoBox(analysis: LogoAnalysis?, widthFraction: Float, maxHeight: Dp): Modifier =
    trimLogoInsets(analysis)
        .fillMaxWidth(widthFraction)
        .heightIn(max = maxHeight)
        .then(if (analysis != null && analysis.aspect > 0f) Modifier.aspectRatio(analysis.aspect) else Modifier)

/** Crops a logo's transparent margins out of layout; see [logoBox], which keeps the box aspect-locked. */
internal fun Modifier.trimLogoInsets(analysis: LogoAnalysis?) = if (analysis == null) this else layout { measurable, constraints ->
    val horizontalShare = if (analysis.aspect > 0f) (1f - analysis.leftInset - analysis.rightInset).coerceIn(.2f, 1f) else 1f
    val measureConstraints = if (constraints.hasBoundedWidth && horizontalShare < 1f) {
        constraints.copy(minWidth = 0, maxWidth = (constraints.maxWidth / horizontalShare).roundToInt())
    } else constraints
    val placeable = measurable.measure(measureConstraints)
    val left = if (horizontalShare < 1f) (placeable.width * analysis.leftInset).roundToInt() else 0
    val right = if (horizontalShare < 1f) (placeable.width * analysis.rightInset).roundToInt() else 0
    val top = (placeable.height * analysis.topInset).roundToInt()
    val bottom = (placeable.height * analysis.bottomInset).roundToInt()
    val width = (placeable.width - left - right).coerceAtLeast(0)
    layout(width, (placeable.height - top - bottom).coerceAtLeast(0)) { placeable.place(-left, -top) }
}
