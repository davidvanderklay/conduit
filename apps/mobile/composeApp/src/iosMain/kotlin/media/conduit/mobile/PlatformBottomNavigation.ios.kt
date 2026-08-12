package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import media.conduit.mobile.foundation.AppDestination

private class ConduitTabSelectionHandler(
    var destinations: List<AppDestination>,
    var onSelect: (AppDestination) -> Unit,
) : IosBottomNavigationSelectionHandler {
    override fun select(index: Int) {
        destinations.getOrNull(index)?.let(onSelect)
    }
}

@Composable
internal actual fun PlatformBottomNavigation(
    destinations: List<AppDestination>,
    selected: AppDestination,
    compact: Boolean,
    classic: Boolean,
    adaptive: Boolean,
    onSelect: (AppDestination) -> Unit,
    modifier: Modifier,
) {
    val handler = remember { ConduitTabSelectionHandler(destinations, onSelect) }
    handler.destinations = destinations
    handler.onSelect = onSelect

    SideEffect {
        IosBottomNavigationBridgeFactory.bridge()?.update(
            visible = true,
            selectedIndex = destinations.indexOf(selected),
            labels = destinations.map(AppDestination::label),
            compact = compact,
            classic = classic,
            adaptive = adaptive,
            selectionHandler = handler,
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            IosBottomNavigationBridgeFactory.bridge()?.update(
                visible = false,
                selectedIndex = -1,
                labels = emptyList(),
                compact = false,
                classic = false,
                adaptive = false,
                selectionHandler = null,
            )
        }
    }
}
