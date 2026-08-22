package media.conduit.mobile

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import kotlin.time.TimeSource

/** One double-tap seek burst. [seconds] accumulates while repeat taps stay inside the stack window. */
internal class SeekPulse internal constructor(internal val id: Long, internal val seconds: Int)

/**
 * Collects double-tap seek events from the player gesture handler so the
 * overlay can render YouTube-style "+10" feedback that stacks during rapid taps.
 */
internal class DoubleTapSeekFeedback {
    var forward: SeekPulse? by mutableStateOf(null)
        private set
    var backward: SeekPulse? by mutableStateOf(null)
        private set

    private var forwardMark: TimeSource.Monotonic.ValueTimeMark? = null
    private var backwardMark: TimeSource.Monotonic.ValueTimeMark? = null
    private var sequence = 0L

    fun record(forwardTap: Boolean) {
        val now = TimeSource.Monotonic.markNow()
        val previous = if (forwardTap) forward else backward
        val lastMark = if (forwardTap) forwardMark else backwardMark
        val stacked = previous != null && lastMark != null &&
            lastMark.elapsedNow().inWholeMilliseconds <= StackWindowMs
        val pulse = SeekPulse(++sequence, if (stacked) previous.seconds + StepSeconds else StepSeconds)
        if (forwardTap) {
            forward = pulse
            forwardMark = now
        } else {
            backward = pulse
            backwardMark = now
        }
    }

    private companion object {
        const val StackWindowMs = 800L
        const val StepSeconds = 10
    }
}

private const val PulseDurationMillis = 650

/**
 * YouTube-style double-tap-to-seek indicator, one pulsing cluster per half of
 * the screen. Purely visual; pointer input passes through so playback gestures
 * keep working underneath.
 */
@Composable
internal fun DoubleTapSeekOverlay(feedback: DoubleTapSeekFeedback, modifier: Modifier = Modifier) {
    Row(modifier) {
        Box(Modifier.weight(1f)) {
            SeekPulseIndicator(
                pulse = feedback.forward,
                icon = Icons.Rounded.KeyboardDoubleArrowRight,
                label = { seconds -> "+$seconds" },
                modifier = Modifier.align(Alignment.Center),
            )
        }
        Box(Modifier.weight(1f)) {
            SeekPulseIndicator(
                pulse = feedback.backward,
                icon = Icons.Rounded.KeyboardDoubleArrowLeft,
                label = { seconds -> "-$seconds" },
                modifier = Modifier.align(Alignment.Center),
            )
        }
    }
}

@Composable
private fun SeekPulseIndicator(
    pulse: SeekPulse?,
    icon: ImageVector,
    label: (Int) -> String,
    modifier: Modifier = Modifier,
) {
    val progress = remember(pulse?.id) { Animatable(1f) }
    LaunchedEffect(pulse?.id) {
        if (pulse == null) return@LaunchedEffect
        progress.snapTo(0f)
        progress.animateTo(1f, tween(PulseDurationMillis, easing = LinearEasing))
    }
    if (pulse == null || progress.value >= 1f) return
    val time = progress.value
    val appear = (time / .12f).coerceIn(0f, 1f)
    val fadeOut = ((time - .55f) / .45f).coerceIn(0f, 1f)
    val alpha = appear * (1f - fadeOut)
    if (alpha <= .01f) return
    val enterScale = lerp(.62f, 1f, (time / .2f).coerceIn(0f, 1f))

    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(104.dp)
                .graphicsLayer {
                    this.alpha = alpha
                    scaleX = enterScale
                    scaleY = enterScale
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) {
                drawCircle(
                    color = Color.White.copy(alpha = .55f * (1f - time)),
                    radius = size.minDimension / 2f,
                    style = Stroke(width = 2.dp.toPx()),
                )
            }
            Box(Modifier.fillMaxSize().clip(CircleShape).background(Color.Black.copy(alpha = .48f)))
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(46.dp))
        }
        Spacer(Modifier.size(6.dp))
        Text(
            label(pulse.seconds),
            color = Color.White,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.graphicsLayer { this.alpha = alpha },
        )
    }
}
