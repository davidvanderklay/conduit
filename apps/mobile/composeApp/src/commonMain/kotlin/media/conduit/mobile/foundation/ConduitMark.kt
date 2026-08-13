package media.conduit.mobile.foundation

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path

@Composable
fun ConduitMark(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val unit = size.minDimension
        val origin = Offset((size.width - unit) / 2f, (size.height - unit) / 2f)
        fun point(x: Float, y: Float) = origin + Offset(unit * x, unit * y)

        drawRoundRect(
            color = Color(0xFF09090B),
            topLeft = origin,
            size = Size(unit, unit),
            cornerRadius = CornerRadius(unit * .219f),
        )
        drawRoundRect(
            color = Color(0xFFFBBF24),
            topLeft = point(.207f, .234f),
            size = Size(unit * .586f, unit * .532f),
            cornerRadius = CornerRadius(unit * .094f),
        )
        drawLine(Color(0xFF09090B), point(.207f, .4f), point(.793f, .4f), unit * .043f)
        drawLine(Color(0xFF09090B), point(.207f, .6f), point(.793f, .6f), unit * .043f)
        drawPath(
            Path().apply {
                moveTo(point(.439f, .387f).x, point(.439f, .387f).y)
                lineTo(point(.627f, .5f).x, point(.627f, .5f).y)
                lineTo(point(.439f, .613f).x, point(.439f, .613f).y)
                close()
            },
            Color(0xFF09090B),
        )
    }
}
