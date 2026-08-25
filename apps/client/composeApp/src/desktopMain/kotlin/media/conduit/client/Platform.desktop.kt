package media.conduit.client

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import media.conduit.client.foundation.AppDestination

@Composable
actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
    onBackCancelled: (() -> Unit)?,
    interactiveBack: Boolean,
) = Unit

actual val platformBackIncludesFullscreenPlayer: Boolean = false
actual val systemPipKeepsAppVisible: Boolean = true

@Composable
actual fun PlayerOrientationLock(active: Boolean) = Unit

@Composable
actual fun windowedIpadTopInset(): Dp = 0.dp

@Composable
internal actual fun PlatformBottomNavigation(
    destinations: List<AppDestination>,
    selected: AppDestination,
    compact: Boolean,
    classic: Boolean,
    adaptive: Boolean,
    adaptiveHidden: Boolean,
    visible: Boolean,
    onSelect: (AppDestination) -> Unit,
    modifier: Modifier,
) {
    if (!visible) return
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        destinations.forEach { destination ->
            MobileNavigationItem(
                destination = destination,
                selected = destination == selected,
                onClick = { onSelect(destination) },
                showLabel = true,
            )
        }
    }
}
