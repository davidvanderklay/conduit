package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

internal data class SystemAccessibility(val reduceMotion: Boolean = false, val screenReader: Boolean = false)
internal val LocalReducedMotion = staticCompositionLocalOf { false }
internal val LocalScreenReader = staticCompositionLocalOf { false }

@Composable
internal expect fun rememberSystemAccessibility(): SystemAccessibility
