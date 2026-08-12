package media.conduit.mobile

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.interop.UIKitView
import androidx.compose.ui.unit.dp
import media.conduit.mobile.foundation.AppDestination
import kotlinx.cinterop.ExperimentalForeignApi
import platform.darwin.NSObject
import platform.UIKit.UIColor
import platform.UIKit.UIImage
import platform.UIKit.UITabBar
import platform.UIKit.UITabBarDelegateProtocol
import platform.UIKit.UITabBarItem

@OptIn(ExperimentalForeignApi::class)
private class ConduitTabBarDelegate(
    var destinations: List<AppDestination>,
    var onSelect: (AppDestination) -> Unit,
) : NSObject(), UITabBarDelegateProtocol {
    override fun tabBar(tabBar: UITabBar, didSelectItem: UITabBarItem) {
        destinations.getOrNull(didSelectItem.tag.toInt())?.let(onSelect)
    }
}

@OptIn(ExperimentalForeignApi::class)
@Composable
internal actual fun PlatformBottomNavigation(
    destinations: List<AppDestination>,
    selected: AppDestination,
    compact: Boolean,
    classic: Boolean,
    onSelect: (AppDestination) -> Unit,
    modifier: Modifier,
) {
    val delegate = remember { ConduitTabBarDelegate(destinations, onSelect) }
    delegate.destinations = destinations
    delegate.onSelect = onSelect
    val items = remember(destinations) {
        destinations.mapIndexed { index, destination ->
            UITabBarItem(
                title = destination.label,
                image = UIImage.systemImageNamed(destination.systemImageName),
                tag = index.toLong(),
            )
        }
    }

    UIKitView(
        factory = {
            UITabBar().apply {
                this.delegate = delegate
                setItems(items, animated = false)
                tintColor = UIColor(red = .98, green = .75, blue = .14, alpha = 1.0)
                unselectedItemTintColor = UIColor.whiteColor.colorWithAlphaComponent(.55)
                backgroundColor = UIColor.clearColor
            }
        },
        update = { tabBar ->
            tabBar.selectedItem = items.getOrNull(destinations.indexOf(selected))
        },
        // Give UIKit enough vertical room for the stacked icon + title layout;
        // the safe-area padding is kept outside the tab bar itself.
        modifier = modifier.fillMaxWidth().navigationBarsPadding().height(76.dp),
        background = Color.Transparent,
        interactive = true,
    )
}

private val AppDestination.systemImageName: String
    get() = when (this) {
        AppDestination.Home -> "house"
        AppDestination.Search -> "safari"
        AppDestination.Library -> "rectangle.stack"
        AppDestination.Profile -> "gearshape"
        AppDestination.Calendar -> "calendar"
        AppDestination.History -> "clock.arrow.circlepath"
    }
