package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import media.conduit.mobile.foundation.AppDestination

/** Uses the system tab bar on iOS so Liquid Glass interaction stays platform-owned. */
@Composable
internal expect fun PlatformBottomNavigation(
    destinations: List<AppDestination>,
    selected: AppDestination,
    compact: Boolean,
    classic: Boolean,
    onSelect: (AppDestination) -> Unit,
    modifier: Modifier = Modifier,
)
