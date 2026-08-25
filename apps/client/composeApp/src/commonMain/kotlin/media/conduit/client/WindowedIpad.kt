package media.conduit.client

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp

/**
 * Extra top padding for player chrome on iPads running windowed
 * (Split View / Stage Manager), where system window controls overlap the spot
 * where the back button would otherwise render.
 */
@Composable
expect fun windowedIpadTopInset(): Dp
