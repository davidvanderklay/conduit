package media.conduit.mobile

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import kotlin.math.roundToInt

/** Controls and blocking overlays suspend the current segment's standalone prompt budget. */
@Composable
internal fun rememberSkipPromptState(
    mediaId: String,
    videoId: String,
    segment: SkipSegment?,
    controlsVisible: Boolean,
    eligible: Boolean,
): SkipPromptState {
    val state = remember(mediaId, videoId, segment) { SkipPromptState() }
    LaunchedEffect(state, controlsVisible, eligible) {
        if (segment != null && eligible && !controlsVisible) state.countDown()
    }
    return state
}

internal class SkipPromptState {
    val progress = Animatable(1f)
    // Only expiry changes visibility. Progress frames should redraw the fill, not recompose the player.
    private val expired by derivedStateOf { progress.value <= 0f }

    fun isVisible(controlsVisible: Boolean, eligible: Boolean): Boolean =
        eligible && (controlsVisible || !expired)

    suspend fun countDown() {
        if (!expired) {
            progress.animateTo(
                targetValue = 0f,
                animationSpec = tween(
                    durationMillis = (progress.value * SKIP_PROMPT_VISIBLE_MS).roundToInt().coerceAtLeast(1),
                    easing = LinearEasing,
                ),
            )
        }
    }
}
