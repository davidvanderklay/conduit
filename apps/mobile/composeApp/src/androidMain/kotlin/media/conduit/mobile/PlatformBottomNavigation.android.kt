package media.conduit.mobile

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import media.conduit.mobile.foundation.AppDestination

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
    Surface(
        color = if (classic) MaterialTheme.colorScheme.surfaceContainer else Color(0xDD202023),
        shape = if (classic) RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp) else RoundedCornerShape(32.dp),
        border = if (classic) null else BorderStroke(1.dp, Color.White.copy(alpha = .12f)),
        shadowElevation = if (classic) 4.dp else 14.dp,
        modifier = modifier
            .then(if (classic) Modifier else Modifier.navigationBarsPadding())
            .then(
                if (classic) Modifier.fillMaxWidth()
                else if (compact) Modifier.padding(horizontal = 64.dp, vertical = 10.dp).fillMaxWidth()
                else Modifier.padding(horizontal = 14.dp, vertical = 10.dp).fillMaxWidth(),
            ),
    ) {
        Row(
            Modifier.fillMaxWidth()
                .then(if (classic) Modifier.navigationBarsPadding() else Modifier)
                .padding(horizontal = 8.dp, vertical = if (compact) 2.dp else 4.dp),
        ) {
            destinations.forEach { destination ->
                MobileNavigationItem(
                    destination = destination,
                    selected = selected == destination,
                    onClick = { onSelect(destination) },
                    showLabel = !compact,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
