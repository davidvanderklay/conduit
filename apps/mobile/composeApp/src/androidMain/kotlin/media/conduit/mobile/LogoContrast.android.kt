package media.conduit.mobile

import android.graphics.Bitmap
import coil3.compose.AsyncImagePainter
import coil3.toBitmap

// Coil may decode into a hardware bitmap, which can't be read directly, so sample a software copy.
internal actual fun AsyncImagePainter.State.Success.analyzeLogo(): LogoAnalysis {
    val software = result.image.toBitmap().copy(Bitmap.Config.ARGB_8888, false)
    val sample = Bitmap.createScaledBitmap(software, LogoSampleWidth, LogoSampleHeight, true)
    val pixels = IntArray(LogoSampleWidth * LogoSampleHeight)
    sample.getPixels(pixels, 0, LogoSampleWidth, 0, 0, LogoSampleWidth, LogoSampleHeight)
    return analyzeLogoPixels(pixels)
}
