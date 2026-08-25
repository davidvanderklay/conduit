package media.conduit.client

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.awt.SwingPanel
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.delay
import media.conduit.client.account.SubtitleItem
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.swing.SwingUtilities

@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    presentation: PlaybackPresentation,
    command: SequencedPlaybackCommand?,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    subtitles: List<SubtitleItem>,
    contentLogo: String?,
    contentTitle: String?,
    hasNextEpisode: Boolean,
    onNextEpisode: () -> Unit,
    hasEpisodes: Boolean,
    hasSources: Boolean,
    touchGestures: Boolean,
    holdToSpeed: Boolean,
    preferredAudioLanguage: String,
    preferredSubtitleLanguage: String,
    androidPlaybackEngine: AndroidPlaybackEngine,
    onEpisodes: () -> Unit,
    onSources: () -> Unit,
    onControlsVisibilityChanged: (Boolean) -> Unit,
    onOverlayVisibilityChanged: (Boolean) -> Unit,
    onTemporarySpeedChanged: (Boolean) -> Unit,
    onSystemPipChanged: (Boolean) -> Unit,
    onSystemPipAvailabilityChanged: (Boolean) -> Unit,
    interactiveResize: Boolean,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val host = remember { DesktopPlayerHost() }
    val handle = remember { AtomicLong(0) }
    val attachment = remember { AtomicLong(0) }
    val latestState = rememberUpdatedState(onState)
    var attachError by remember(url) { mutableStateOf<String?>(null) }
    var retryGeneration by remember(url) { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        onSystemPipAvailabilityChanged(false)
        onSystemPipChanged(false)
    }

    LaunchedEffect(command?.sequence) {
        val player = handle.get()
        when (val action = command?.command) {
            PlaybackCommand.Play -> if (player != 0L) DesktopNativePlayerBridge.setPaused(player, false)
            PlaybackCommand.Pause -> if (player != 0L) DesktopNativePlayerBridge.setPaused(player, true)
            is PlaybackCommand.SeekTo -> if (player != 0L) DesktopNativePlayerBridge.seekTo(player, action.positionMs)
            PlaybackCommand.RetryVideoOutput -> retryGeneration += 1
            PlaybackCommand.EnterSystemPip, null -> Unit
        }
    }

    DisposableEffect(host, url, active, requestHeaders, startPositionMs, retryGeneration) {
        val generation = attachment.incrementAndGet()
        val attaching = AtomicBoolean(false)

        fun attach() {
            if (!active || url == null || !host.isDisplayable || !attaching.compareAndSet(false, true)) return
            if (!DesktopNativePlayerBridge.available) {
                attachError = DesktopNativePlayerBridge.loadError?.message ?: "The Linux player bridge is unavailable"
                return
            }
            val windowId = runCatching { AwtX11WindowResolver.resolve(host) }
                .getOrElse { cause ->
                    attachError = cause.message ?: "Unable to resolve the Linux player window"
                    return
                }
            val headers = requestHeaders.map { (name, value) -> "$name: $value" }.toTypedArray()
            Thread({
                val created = runCatching {
                    DesktopNativePlayerBridge.create(
                        windowId = windowId,
                        url = url,
                        headers = headers,
                        startPositionMs = startPositionMs,
                        paused = false,
                    )
                }.getOrElse { cause ->
                    SwingUtilities.invokeLater {
                        if (attachment.get() == generation) {
                            attachError = cause.message ?: "libmpv could not start"
                        }
                    }
                    0L
                }
                if (created == 0L) {
                    SwingUtilities.invokeLater {
                        if (attachment.get() == generation && attachError == null) {
                            attachError = "libmpv could not initialize an X11 video output"
                        }
                    }
                } else if (attachment.get() == generation && active) {
                    handle.set(created)
                    SwingUtilities.invokeLater { attachError = null }
                } else {
                    DesktopNativePlayerBridge.dispose(created)
                }
            }, "conduit-mpv-create").apply {
                isDaemon = true
                start()
            }
        }

        host.onPeerReady = ::attach
        if (host.isDisplayable) SwingUtilities.invokeLater(::attach)

        onDispose {
            attachment.incrementAndGet()
            host.onPeerReady = null
            val previous = handle.getAndSet(0)
            if (previous != 0L) {
                Thread({ DesktopNativePlayerBridge.dispose(previous) }, "conduit-mpv-dispose").apply {
                    isDaemon = true
                    start()
                }
            }
        }
    }

    LaunchedEffect(active, url, retryGeneration) {
        while (active && url != null) {
            val player = handle.get()
            val state = if (player == 0L) {
                PlaybackState(loading = attachError == null, error = attachError, engine = NativePlaybackEngine.Libmpv)
            } else {
                runCatching {
                    val loading = DesktopNativePlayerBridge.isLoading(player)
                    val paused = DesktopNativePlayerBridge.isPaused(player)
                    val ended = DesktopNativePlayerBridge.isEnded(player)
                    PlaybackState(
                        loading = loading,
                        buffering = loading,
                        playing = !loading && !paused && !ended,
                        positionMs = DesktopNativePlayerBridge.positionMs(player),
                        durationMs = DesktopNativePlayerBridge.durationMs(player),
                        videoWidth = DesktopNativePlayerBridge.videoWidth(player),
                        videoHeight = DesktopNativePlayerBridge.videoHeight(player),
                        ended = ended,
                        pipReady = false,
                        engine = NativePlaybackEngine.Libmpv,
                    )
                }.getOrElse { cause ->
                    PlaybackState(
                        loading = false,
                        error = cause.message ?: "Unable to read libmpv playback state",
                        engine = NativePlaybackEngine.Libmpv,
                    )
                }
            }
            latestState.value(state)
            delay(250)
        }
    }

    Box(modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        if (active && url != null && DesktopNativePlayerBridge.available) {
            SwingPanel(
                factory = { host },
                background = Color.Black,
                modifier = Modifier.fillMaxSize(),
            )
        }
        attachError?.let { message ->
            Text(message, color = MaterialTheme.colorScheme.error)
        }
    }
}
