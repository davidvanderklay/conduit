package media.conduit.mobile

import android.graphics.Bitmap
import coil3.compose.AsyncImagePainter
import coil3.toBitmap

// Coil may decode into a hardware bitmap, which can't be read directly, so sample a software copy.
internal actual fun AsyncImagePainter.State.Success.isDarkLogo(): Boolean {
    val software = result.image.toBitmap().copy(Bitmap.Config.ARGB_8888, false)
    val sample = Bitmap.createScaledBitmap(software, 64, 32, true)
    val pixels = IntArray(64 * 32)
    sample.getPixels(pixels, 0, 64, 0, 0, 64, 32)
    return isDarkLogoPixels(pixels)
}
