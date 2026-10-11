package media.conduit.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import conduit_mobile.composeapp.generated.resources.Res
import conduit_mobile.composeapp.generated.resources.loading
import media.conduit.mobile.foundation.LocalReducedMotion
import org.jetbrains.compose.resources.stringResource

/** Animate while loading unless the user requests reduced motion. */
@Composable
internal fun LoadingIndicator(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    strokeWidth: Dp = 4.dp,
    trackColor: Color = Color.Transparent,
    strokeCap: androidx.compose.ui.graphics.StrokeCap = androidx.compose.ui.graphics.StrokeCap.Round,
) {
    val label = stringResource(Res.string.loading)
    val indicatorModifier = modifier.size(24.dp).semantics { contentDescription = label }
    if (!LocalReducedMotion.current) {
        CircularProgressIndicator(
            modifier = indicatorModifier,
            color = color,
            strokeWidth = strokeWidth,
            trackColor = trackColor,
            strokeCap = strokeCap,
        )
        return
    }
    Canvas(indicatorModifier) {
        val stroke = Stroke(strokeWidth.toPx(), cap = strokeCap)
        drawArc(trackColor, -90f, 360f, false, style = stroke)
        drawArc(color, -90f, 240f, false, style = stroke)
    }
}
