package media.conduit.mobile

import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp

internal const val TABLET_LAYOUT_MIN_WIDTH_DP = 600

internal fun usesAdaptiveMediaGrid(windowWidthDp: Int): Boolean =
    windowWidthDp >= TABLET_LAYOUT_MIN_WIDTH_DP

internal fun mediaGridColumns(windowWidthDp: Int): GridCells =
    if (usesAdaptiveMediaGrid(windowWidthDp)) GridCells.Adaptive(170.dp) else EqualColumns(3)

/**
 * Like [GridCells.Fixed], but every column gets the same whole-pixel width. Fixed hands leftover
 * pixels to the first columns, which makes 2:3 posters in the last column a pixel shorter.
 */
internal class EqualColumns(private val count: Int) : GridCells {
    override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> {
        val cell = ((availableSize - spacing * (count - 1)) / count).coerceAtLeast(0)
        return List(count) { cell }
    }
}

// Match the search field's height so large text never overlaps the page heading.
internal fun mainTopBarHeight(fontScale: Float) = (48f + 20f * (fontScale - 1f).coerceAtLeast(0f)).dp
