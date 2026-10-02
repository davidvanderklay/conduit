package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import media.conduit.mobile.foundation.SubtitleStyle

private val SubtitlePreviewHeight = 96.dp

/**
 * Size, position, and outline controls shared by the Playback settings screen
 * and the in-player subtitle panels. The preview stands in for the video,
 * which the settings screen does not have and the phone panel covers.
 */
@Composable
fun SubtitleStyleControls(
    style: SubtitleStyle,
    onChange: (SubtitleStyle) -> Unit,
    modifier: Modifier = Modifier,
    contentColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Column(modifier) {
        SubtitleStylePreview(style)
        SubtitleStepper(
            label = "Size",
            value = "${style.sizePercent}%",
            contentColor = contentColor,
            canDecrease = style.sizePercent > SubtitleStyle.SizeRange.first,
            canIncrease = style.sizePercent < SubtitleStyle.SizeRange.last,
            onStep = { direction ->
                onChange(style.copy(sizePercent = (style.sizePercent + direction * SubtitleStyle.SizeStep).coerceIn(SubtitleStyle.SizeRange)))
            },
        )
        SubtitleStepper(
            label = "Position",
            value = if (style.offsetPercent == 0) "Bottom" else "+${style.offsetPercent}%",
            contentColor = contentColor,
            canDecrease = style.offsetPercent > SubtitleStyle.OffsetRange.first,
            canIncrease = style.offsetPercent < SubtitleStyle.OffsetRange.last,
            onStep = { direction ->
                onChange(style.copy(offsetPercent = (style.offsetPercent + direction * SubtitleStyle.OffsetStep).coerceIn(SubtitleStyle.OffsetRange)))
            },
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Outline", color = contentColor, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Switch(style.outline, { onChange(style.copy(outline = it)) })
        }
    }
}

@Composable
private fun SubtitleStylePreview(style: SubtitleStyle) {
    val text = "Subtitle preview"
    val textStyle = TextStyle(fontSize = 12.sp * style.scale, textAlign = TextAlign.Center)
    Box(
        Modifier
            .fillMaxWidth()
            .height(SubtitlePreviewHeight)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF3A3A40)),
    ) {
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = SubtitlePreviewHeight * (.05f + style.offsetPercent / 100f)),
        ) {
            if (style.outline) {
                Text(text, color = Color.Black, style = textStyle.copy(drawStyle = Stroke(width = 4f)), maxLines = 1)
            }
            Text(text, color = Color.White, style = textStyle, maxLines = 1)
        }
    }
}

/** A labelled value with minus and plus buttons; [onStep] receives -1 or 1. */
@Composable
private fun SubtitleStepper(
    label: String,
    value: String,
    contentColor: Color,
    canDecrease: Boolean,
    canIncrease: Boolean,
    onStep: (Int) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = contentColor, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        IconButton(onClick = { onStep(-1) }, enabled = canDecrease, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Rounded.Remove, "Decrease $label", tint = contentColor.copy(alpha = if (canDecrease) 1f else .3f))
        }
        Text(value, color = contentColor, textAlign = TextAlign.Center, modifier = Modifier.width(64.dp))
        IconButton(onClick = { onStep(1) }, enabled = canIncrease, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Rounded.Add, "Increase $label", tint = contentColor.copy(alpha = if (canIncrease) 1f else .3f))
        }
    }
}
