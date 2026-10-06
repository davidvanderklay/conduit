package media.conduit.mobile

import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.unit.dp

internal const val TABLET_LAYOUT_MIN_WIDTH_DP = 600

internal fun usesAdaptiveMediaGrid(windowWidthDp: Int): Boolean =
    windowWidthDp >= TABLET_LAYOUT_MIN_WIDTH_DP

internal fun mediaGridColumns(windowWidthDp: Int): GridCells =
    if (usesAdaptiveMediaGrid(windowWidthDp)) GridCells.Adaptive(170.dp) else GridCells.Fixed(3)

// Match the search field's height so large text never overlaps the page heading.
internal fun mainTopBarHeight(fontScale: Float) = (52f + 20f * (fontScale - 1f).coerceAtLeast(0f)).dp
