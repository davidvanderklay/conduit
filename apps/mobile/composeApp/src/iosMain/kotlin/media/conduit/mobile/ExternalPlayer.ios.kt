package media.conduit.mobile

import androidx.compose.runtime.Composable

@Composable
internal actual fun rememberExternalPlayerLauncher(): ((ExternalPlayerRequest) -> Boolean)? = null
