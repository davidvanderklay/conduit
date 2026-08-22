package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.useContents
import platform.UIKit.UIApplication
import platform.UIKit.UIDevice
import platform.UIKit.UIUserInterfaceIdiomPad
import platform.UIKit.UISceneActivationStateForegroundActive
import platform.UIKit.UIScreen
import platform.UIKit.UIWindowScene

@Composable
actual fun windowedIpadTopInset(): Dp = if (isIpadWindowed()) 34.dp else 0.dp

/**
 * Mirrors the windowed-iPad heuristic used by the playback bridge: on an iPad
 * whose window covers less than ~98% of the screen, system window controls
 * occupy the top-left of the app's content area.
 */
@OptIn(ExperimentalForeignApi::class)
private fun isIpadWindowed(): Boolean {
    if (UIDevice.currentDevice.userInterfaceIdiom != UIUserInterfaceIdiomPad) return false
    val screenArea = UIScreen.mainScreen.bounds.useContents { size.width * size.height }
    if (screenArea <= 0.0) return false
    for (rawScene in UIApplication.sharedApplication.connectedScenes) {
        val scene = rawScene as? UIWindowScene ?: continue
        if (scene.activationState != UISceneActivationStateForegroundActive) continue
        val window = scene.keyWindow ?: continue
        val windowArea = window.bounds.useContents { size.width * size.height }
        if (windowArea > 0.0 && windowArea < screenArea * .98) return true
    }
    return false
}
