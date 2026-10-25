package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Hearing
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import kotlin.time.TimeSource
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
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
 * which the settings screen does not have and the phone panel covers. Players
 * pass [delayMs] to add the per-title delay control, [onSyncByEar] to offer
 * [SubtitleSyncByEarCard] beside it, and [onAutoSync] to offer auto sync
 * against embedded subtitles, whose delay this applies.
 */
@Composable
fun SubtitleStyleControls(
    style: SubtitleStyle,
    onChange: (SubtitleStyle) -> Unit,
    modifier: Modifier = Modifier,
    contentColor: Color = MaterialTheme.colorScheme.onSurface,
    delayMs: Long? = null,
    onDelayChange: (Long) -> Unit = {},
    onSyncByEar: (() -> Unit)? = null,
    onAutoSync: (suspend () -> SubtitleAutoSyncResult)? = null,
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
        delayMs?.let { delay ->
            SubtitleStepper(
                label = "Delay",
                value = formatSubtitleDelay(delay),
                contentColor = contentColor,
                canDecrease = stepSubtitleDelay(delay, -SubtitleDelayStepMs) != delay,
                canIncrease = stepSubtitleDelay(delay, SubtitleDelayStepMs) != delay,
                repeatOnHold = true,
                onStep = { steps -> onDelayChange(stepSubtitleDelay(delay, steps * SubtitleDelayStepMs)) },
            )
            if (delay != 0L) {
                TextButton(
                    onClick = { onDelayChange(0) },
                    modifier = Modifier.align(Alignment.End).focusRing(RoundedCornerShape(50), Color.White),
                ) { Text("Reset delay", color = MaterialTheme.colorScheme.primary) }
            }
            SubtitleSyncActions(onSyncByEar, onAutoSync, onDelayChange, contentColor)
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Outline", color = contentColor, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Switch(style.outline, { onChange(style.copy(outline = it)) }, modifier = Modifier.focusRing(RoundedCornerShape(50), Color.White))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SubtitleSyncActions(
    onSyncByEar: (() -> Unit)?,
    onAutoSync: (suspend () -> SubtitleAutoSyncResult)?,
    onDelayChange: (Long) -> Unit,
    contentColor: Color,
) {
    if (onSyncByEar == null && onAutoSync == null) return
    val scope = rememberCoroutineScope()
    var running by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<SubtitleAutoSyncResult?>(null) }
    val latestDelayChange by rememberUpdatedState(onDelayChange)
    @Composable
    fun Action(icon: ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
        TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.focusRing(RoundedCornerShape(50), Color.White)) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Text(label, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 6.dp))
        }
    }
    FlowRow {
        onSyncByEar?.let { Action(Icons.Rounded.Hearing, "Sync by ear", onClick = it) }
        onAutoSync?.let { autoSync ->
            Action(Icons.Rounded.AutoFixHigh, if (running) "Syncing…" else "Auto sync", enabled = !running) {
                running = true
                scope.launch {
                    val outcome = autoSync()
                    if (outcome is SubtitleAutoSyncResult.Synced) latestDelayChange(outcome.delayMs)
                    result = outcome
                    running = false
                }
            }
        }
    }
    result?.let { outcome ->
        Text(
            when (outcome) {
                is SubtitleAutoSyncResult.Synced -> "Matched the embedded subtitles."
                is SubtitleAutoSyncResult.Failed -> outcome.reason
            },
            color = contentColor.copy(alpha = .6f),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
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

/**
 * A labelled value with minus and plus buttons. [onStep] receives the signed
 * number of steps: one per press, and with [repeatOnHold] repeats while the
 * button is held by touch or a remote's select key.
 */
@Composable
private fun SubtitleStepper(
    label: String,
    value: String,
    contentColor: Color,
    canDecrease: Boolean,
    canIncrease: Boolean,
    repeatOnHold: Boolean = false,
    onStep: (Int) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = contentColor, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        SubtitleStepButton(-1, "Decrease $label", Icons.Rounded.Remove, canDecrease, repeatOnHold, contentColor, onStep)
        Text(value, color = contentColor, textAlign = TextAlign.Center, modifier = Modifier.width(64.dp))
        SubtitleStepButton(1, "Increase $label", Icons.Rounded.Add, canIncrease, repeatOnHold, contentColor, onStep)
    }
}

@Composable
private fun SubtitleStepButton(
    direction: Int,
    description: String,
    icon: ImageVector,
    enabled: Boolean,
    repeatOnHold: Boolean,
    contentColor: Color,
    onStep: (Int) -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val latestStep by rememberUpdatedState(onStep)
    // The click that ends a held repeat must not add one more step.
    var repeated by remember { mutableStateOf(false) }
    if (repeatOnHold) {
        val pressed by interaction.collectIsPressedAsState()
        LaunchedEffect(pressed) {
            if (!pressed) return@LaunchedEffect
            repeated = false
            delay(400)
            repeated = true
            val started = TimeSource.Monotonic.markNow()
            while (true) {
                latestStep(direction * heldSubtitleDelaySteps(started.elapsedNow().inWholeMilliseconds))
                delay(100)
            }
        }
    }
    IconButton(
        onClick = { if (repeated) repeated = false else latestStep(direction) },
        enabled = enabled,
        interactionSource = interaction,
        modifier = Modifier.size(40.dp).focusRing(CircleShape, Color.White),
    ) {
        Icon(icon, description, tint = contentColor.copy(alpha = if (enabled) 1f else .3f))
    }
}
