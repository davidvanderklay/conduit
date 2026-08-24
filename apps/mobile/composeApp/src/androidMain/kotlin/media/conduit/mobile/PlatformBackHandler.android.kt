package media.conduit.mobile

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable

@Composable
actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
    onBackCancelled: (() -> Unit)?,
    interactiveBack: Boolean,
) {
    BackHandler(enabled = enabled, onBack = onBack)
}

actual val platformBackIncludesFullscreenPlayer: Boolean = true
