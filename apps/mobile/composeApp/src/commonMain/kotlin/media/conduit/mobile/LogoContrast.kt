package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Constraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImagePainter
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.size.Size
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
 * Sizes a title logo so its visible lettering (transparent margins cropped on every side) fits within
 * [widthFraction] of the available width ([wideWidthFraction] for thin wordmarks wider than 8:1) and [maxHeight], keeping the image's aspect ratio. The image is
 * measured at exactly the size that places its lettering in that box and clipped to it, so a logo can
 * never draw into neighbouring content. Until the image is analyzed, it falls back to a plain box.
 */
internal fun Modifier.logoBox(analysis: LogoAnalysis?, widthFraction: Float, maxHeight: Dp, wideWidthFraction: Float = widthFraction): Modifier {
    if (analysis == null || analysis.aspect <= 0f) return fillMaxWidth(widthFraction).heightIn(max = maxHeight)
    val horizontalShare = (1f - analysis.leftInset - analysis.rightInset).coerceIn(.2f, 1f)
    val verticalShare = (1f - analysis.topInset - analysis.bottomInset).coerceIn(.2f, 1f)
    val visibleAspect = analysis.aspect * horizontalShare / verticalShare
    return clipToBounds().layout { measurable, constraints ->
        val maxVisibleWidth = constraints.maxWidth * if (visibleAspect > 8f) wideWidthFraction else widthFraction
        val visibleWidth = minOf(maxVisibleWidth, maxHeight.toPx() * visibleAspect)
        val visibleHeight = visibleWidth / visibleAspect
        val imageWidth = (visibleWidth / horizontalShare).roundToInt()
        val imageHeight = (visibleHeight / verticalShare).roundToInt()
        val placeable = measurable.measure(Constraints.fixed(imageWidth, imageHeight))
        layout(visibleWidth.roundToInt(), visibleHeight.roundToInt()) {
            placeable.place(-(imageWidth * analysis.leftInset).roundToInt(), -(imageHeight * analysis.topInset).roundToInt())
        }
    }
}

/**
 * Title logos are small images that get cropped and scaled by [logoBox], so decode them at full
 * resolution rather than at the pre-crop box size, which would leave the visible lettering soft.
 */
@Composable
internal fun rememberLogoRequest(url: String?): ImageRequest? {
    val context = LocalPlatformContext.current
    return remember(url, context) { url?.let { ImageRequest.Builder(context).data(it).size(Size.ORIGINAL).build() } }
}
