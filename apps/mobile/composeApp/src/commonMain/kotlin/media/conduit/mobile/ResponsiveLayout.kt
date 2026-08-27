package media.conduit.mobile

import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.unit.dp

internal const val TABLET_LAYOUT_MIN_WIDTH_DP = 600

internal fun usesAdaptiveMediaGrid(windowWidthDp: Int): Boolean =
    windowWidthDp >= TABLET_LAYOUT_MIN_WIDTH_DP

internal fun mediaGridColumns(windowWidthDp: Int): GridCells =
    if (usesAdaptiveMediaGrid(windowWidthDp)) GridCells.Adaptive(170.dp) else GridCells.Fixed(3)
