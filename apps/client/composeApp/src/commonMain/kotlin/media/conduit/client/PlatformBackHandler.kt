package media.conduit.client

import androidx.compose.runtime.Composable

@Composable
expect fun PlatformBackHandler(
    enabled: Boolean = true,
    onBack: () -> Unit,
    onBackCancelled: (() -> Unit)? = null,
    interactiveBack: Boolean = false,
)

expect val platformBackIncludesFullscreenPlayer: Boolean
