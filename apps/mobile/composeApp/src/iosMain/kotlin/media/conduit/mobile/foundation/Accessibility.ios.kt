@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package media.conduit.mobile.foundation

import androidx.compose.runtime.*
import platform.Foundation.NSNotificationCenter
import platform.UIKit.UIAccessibilityIsReduceMotionEnabled
import platform.UIKit.UIAccessibilityIsVoiceOverRunning
import platform.UIKit.UIAccessibilityReduceMotionStatusDidChangeNotification
import platform.UIKit.UIAccessibilityVoiceOverStatusDidChangeNotification

@Composable
internal actual fun rememberSystemAccessibility(): SystemAccessibility {
    fun read() = SystemAccessibility(UIAccessibilityIsReduceMotionEnabled(), UIAccessibilityIsVoiceOverRunning())
    var settings by remember { mutableStateOf(read()) }
    DisposableEffect(Unit) {
        val center = NSNotificationCenter.defaultCenter
        val observers = listOf(UIAccessibilityReduceMotionStatusDidChangeNotification, UIAccessibilityVoiceOverStatusDidChangeNotification).map { name ->
            center.addObserverForName(name, `object` = null, queue = null) { _ -> settings = read() }
        }
        onDispose { observers.forEach(center::removeObserver) }
    }
    return settings
}
