package media.conduit.mobile

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.Modifier
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import media.conduit.mobile.account.SubtitleItem

private const val PlayerHoldToSpeedDelayMs = 450L
private const val PlayerDoubleTapTimeoutMs = 300L

/** The app can expose PiP only after the native player has a usable video timeline. */
fun isSystemPipActionReady(systemPipAvailable: Boolean, playback: PlaybackState): Boolean =
    systemPipAvailable && playback.pipReady && !playback.loading && playback.durationMs > 0 && playback.error == null

/** The center transport control should never compete with a seek or buffering indicator. */
fun shouldShowCenterPlaybackControl(
    controlsVisible: Boolean,
    seeking: Boolean,
    buffering: Boolean,
    systemPip: Boolean = false,
): Boolean = controlsVisible && !seeking && !buffering && !systemPip

/**
 * Keeps the temporary 2x speed hold alive through pointer movement while retaining
 * single-tap and double-tap behavior. Gestures are abandoned when a child
 * control consumes the pointer, so transport controls keep exclusive clicks.
 */
suspend fun PointerInputScope.detectMovementTolerantPlayerGestures(
    touchGestures: Boolean,
    holdToSpeed: Boolean,
    holdToSpeedReady: Boolean,
    doubleTapSlopPx: Float,
    currentSpeed: () -> Float,
    setSpeed: (Float) -> Unit,
    onTemporarySpeedChanged: (Boolean) -> Unit,
    onTap: () -> Unit,
    onDoubleTap: (Offset) -> Unit,
) = coroutineScope {
    var lastTapTime = Long.MIN_VALUE
    var lastTapPosition = Offset.Unspecified
    var pendingTap: Job? = null

    while (true) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var holdTriggered = false
            var restoredSpeed: Float? = null
            var completedWithUp = false
            var consumedByControl = down.isConsumed
            val holdJob = if (holdToSpeed && holdToSpeedReady && !consumedByControl) {
                launch {
                    delay(PlayerHoldToSpeedDelayMs)
                    restoredSpeed = currentSpeed()
                    holdTriggered = true
                    setSpeed(2f)
                    pendingTap?.cancel()
                    pendingTap = null
                    onTemporarySpeedChanged(true)
                }
            } else {
                null
            }

            try {
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id }
                    if (change == null) break
                    if (change.isConsumed) {
                        consumedByControl = true
                        holdJob?.cancel()
                    }
                    if (!change.pressed) {
                        completedWithUp = true
                        break
                    }
                }
            } finally {
                holdJob?.cancel()
                if (holdTriggered) {
                    restoredSpeed?.let(setSpeed)
                    onTemporarySpeedChanged(false)
                }
            }

            if (!completedWithUp || holdTriggered || consumedByControl) return@awaitEachGesture

            val upTime = down.uptimeMillis
            val isDoubleTap = touchGestures &&
                lastTapPosition != Offset.Unspecified &&
                upTime - lastTapTime in 1..PlayerDoubleTapTimeoutMs &&
                (down.position - lastTapPosition).getDistance() <= doubleTapSlopPx

            if (isDoubleTap) {
                pendingTap?.cancel()
                pendingTap = null
                lastTapTime = Long.MIN_VALUE
                lastTapPosition = Offset.Unspecified
                onDoubleTap(down.position)
            } else {
                lastTapTime = upTime
                lastTapPosition = down.position
                pendingTap?.cancel()
                pendingTap = launch {
                    delay(PlayerDoubleTapTimeoutMs)
                    onTap()
                    pendingTap = null
                }
            }
        }
    }
}

expect val systemPipKeepsAppVisible: Boolean

@Composable
expect fun PlayerOrientationLock(active: Boolean, iosPlaybackEngine: IosPlaybackEngine = IosPlaybackEngine.KSPlayer)

@Composable
expect fun NativePlayer(
    url: String?,
    active: Boolean,
    presentation: PlaybackPresentation = PlaybackPresentation.FullScreen,
    command: SequencedPlaybackCommand? = null,
    startPositionMs: Long = 0,
    requestHeaders: Map<String, String> = emptyMap(),
    subtitles: List<SubtitleItem> = emptyList(),
    contentLogo: String? = null,
    contentTitle: String? = null,
    hasNextEpisode: Boolean = false,
    onNextEpisode: () -> Unit = {},
    hasEpisodes: Boolean = false,
    hasSources: Boolean = true,
    touchGestures: Boolean = true,
    holdToSpeed: Boolean = true,
    preferredAudioLanguage: String = "System default",
    preferredSubtitleLanguage: String = "English",
    androidPlaybackEngine: AndroidPlaybackEngine = AndroidPlaybackEngine.Automatic,
    iosPlaybackEngine: IosPlaybackEngine = IosPlaybackEngine.KSPlayer,
    onEpisodes: () -> Unit = {},
    onSources: () -> Unit = {},
    onControlsVisibilityChanged: (Boolean) -> Unit = {},
    onTemporarySpeedChanged: (Boolean) -> Unit = {},
    onSystemPipChanged: (Boolean) -> Unit = {},
    onSystemPipAvailabilityChanged: (Boolean) -> Unit = {},
    interactiveResize: Boolean = false,
    modifier: Modifier = Modifier,
    onState: (PlaybackState) -> Unit,
)
