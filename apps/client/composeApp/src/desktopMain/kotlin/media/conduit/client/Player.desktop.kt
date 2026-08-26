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
    controlsVisible: Boolean,
    onBack: () -> Unit,
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
    val overlay = remember { DesktopPlayerOverlay() }
    val handle = remember { AtomicLong(0) }
    val attachment = remember { AtomicLong(0) }
    val latestState = rememberUpdatedState(onState)
    var attachError by remember(url) { mutableStateOf<String?>(null) }
    var retryGeneration by remember(url) { mutableIntStateOf(0) }
    val loadedSubtitleKeys = remember(url, retryGeneration) { mutableSetOf<String>() }

    LaunchedEffect(Unit) {
        onSystemPipAvailabilityChanged(false)
        onSystemPipChanged(false)
        onControlsVisibilityChanged(true)
        onOverlayVisibilityChanged(false)
    }

    LaunchedEffect(active, url, presentation, controlsVisible) {
        overlay.setActive(active && url != null && presentation == PlaybackPresentation.FullScreen)
        overlay.setControlsVisible(controlsVisible)
    }

    overlay.updateContent(
        title = contentTitle,
        metadata = "Direct Play · Linux libmpv",
        hasNextEpisode = hasNextEpisode,
        hasEpisodes = hasEpisodes,
        hasSources = hasSources,
    )
    overlay.updateActions(
        DesktopPlayerOverlayActions(
            onTogglePlayback = {
                val player = handle.get()
                if (player != 0L) {
                    DesktopNativePlayerBridge.setPaused(player, !DesktopNativePlayerBridge.isPaused(player))
                }
            },
            onSeekTo = { positionMs ->
                val player = handle.get()
                if (player != 0L) DesktopNativePlayerBridge.seekTo(player, positionMs)
            },
            onNextEpisode = onNextEpisode,
            onEpisodes = onEpisodes,
            onSources = onSources,
            onCycleSubtitle = {
                val player = handle.get()
                if (player != 0L) DesktopNativePlayerBridge.cycleSubtitle(player)
            },
            onCycleAudio = {
                val player = handle.get()
                if (player != 0L) DesktopNativePlayerBridge.cycleAudio(player)
            },
            onSetVolume = { volume ->
                val player = handle.get()
                if (player != 0L) DesktopNativePlayerBridge.setVolume(player, volume)
            },
            onToggleMute = {
                val player = handle.get()
                if (player != 0L) DesktopNativePlayerBridge.setMuted(
                    player,
                    !DesktopNativePlayerBridge.isMuted(player),
                )
            },
            onBack = onBack,
            onControlsVisibilityChanged = onControlsVisibilityChanged,
        ),
    )

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
                        preferredAudioLanguage = desktopMpvLanguageCode(preferredAudioLanguage),
                        preferredSubtitleLanguage = desktopMpvLanguageCode(preferredSubtitleLanguage),
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

        host.onPeerReady = {
            overlay.attach(host)
            attach()
        }
        if (host.isDisplayable) {
            SwingUtilities.invokeLater {
                overlay.attach(host)
                attach()
            }
        }

        onDispose {
            attachment.incrementAndGet()
            host.onPeerReady = null
            overlay.dispose()
            val previous = handle.getAndSet(0)
            if (previous != 0L) {
                Thread({ DesktopNativePlayerBridge.dispose(previous) }, "conduit-mpv-dispose").apply {
                    isDaemon = true
                    start()
                }
            }
        }
    }

    LaunchedEffect(active, url, retryGeneration, subtitles, preferredSubtitleLanguage) {
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
            if (player != 0L && subtitles.isNotEmpty()) {
                val preferred = desktopMpvLanguageCode(preferredSubtitleLanguage)
                val selectedIndex = subtitles.indexOfFirst { subtitle ->
                    val language = subtitle.lang
                        ?.replace('_', '-')
                        ?.substringBefore('-')
                        ?.lowercase()
                    preferred != null && language == preferred
                }.takeIf { it >= 0 } ?: 0
                subtitles.forEachIndexed { index, subtitle ->
                    val key = subtitle.id ?: subtitle.url
                    if (loadedSubtitleKeys.add(key)) {
                        runCatching {
                            DesktopNativePlayerBridge.addSubtitle(
                                player,
                                subtitle.url,
                                select = index == selectedIndex,
                            )
                        }
                    }
                }
            }
            if (host.isDisplayable) overlay.attach(host)
            overlay.updateState(
                DesktopPlayerOverlayState(
                    playing = state.playing,
                    buffering = state.buffering,
                    positionMs = state.positionMs,
                    durationMs = state.durationMs,
                    volume = if (player == 0L) 100f else DesktopNativePlayerBridge.volume(player),
                    muted = player != 0L && DesktopNativePlayerBridge.isMuted(player),
                ),
            )
            overlay.syncBounds()
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

private fun desktopMpvLanguageCode(preference: String): String? = when (preference) {
    "System default" -> java.util.Locale.getDefault().language.takeIf(String::isNotBlank)
    "English" -> "en"
    "Spanish" -> "es"
    "French" -> "fr"
    "German" -> "de"
    "Japanese" -> "ja"
    "Korean" -> "ko"
    else -> preference
        .takeIf(String::isNotBlank)
        ?.replace('_', '-')
        ?.substringBefore('-')
        ?.lowercase()
}
