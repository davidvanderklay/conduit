package media.conduit.client

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Carries the real window safe-area top inset from the platform shell into
 * Compose. iPadOS 26 reports zero insets to the embedded Compose view, which
 * makes the top bar draw under the system status bar; the SwiftUI host
 * publishes the true value here and App() pads by whatever Compose itself
 * does not already account for. Android never publishes, so this stays 0.
 */
object PlatformSafeArea {
    var topInset: Dp by mutableStateOf(0.dp)
        private set

    fun publish(topInsetPt: Float) {
        topInset = topInsetPt.toDouble().dp
    }
}
