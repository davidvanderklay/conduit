package media.conduit.mobile

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import coil3.compose.AsyncImagePainter

// Skia images draw into an offscreen bitmap that can be read back directly.
internal actual fun AsyncImagePainter.State.Success.analyzeLogo(): LogoAnalysis {
    val bitmap = ImageBitmap(LogoSampleWidth, LogoSampleHeight)
    CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, Canvas(bitmap), Size(LogoSampleWidth.toFloat(), LogoSampleHeight.toFloat())) {
        with(painter) { draw(size) }
    }
    val pixels = IntArray(LogoSampleWidth * LogoSampleHeight)
    bitmap.readPixels(pixels)
    return analyzeLogoPixels(pixels)
}
