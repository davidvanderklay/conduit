package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.interop.UIKitViewController
import androidx.compose.ui.unit.dp
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.account.SubtitleItem

private data class IosTrack(
    val id: Int,
    val label: String,
    val language: String,
    val selected: Boolean,
)

@OptIn(ExperimentalForeignApi::class)
@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    subtitles: List<SubtitleItem>,
    hasEpisodes: Boolean,
    touchGestures: Boolean,
    holdToSpeed: Boolean,
    preferredAudioLanguage: String,
    onEpisodes: () -> Unit,
    onControlsVisibilityChanged: (Boolean) -> Unit,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val currentCallback by rememberUpdatedState(onState)
    val latestControlsCallback by rememberUpdatedState(onControlsVisibilityChanged)
    val bridge = remember { IosPlayerBridgeFactory.create() }

    if (bridge == null) {
        LaunchedEffect(Unit) {
            currentCallback(
                PlaybackState(
                    loading = false,
                    error = "The iOS MPVKit player is not registered in this build.",
                ),
            )
        }
        Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
            Text(
                "iOS playback is unavailable in this build.",
                color = Color.White.copy(alpha = .72f),
                modifier = Modifier.padding(24.dp),
            )
        }
        return
    }

    var controlsVisible by remember(bridge) { mutableStateOf(true) }
    var dragging by remember(bridge) { mutableStateOf(false) }
    var draggedPosition by remember(bridge) { mutableLongStateOf(0L) }
    var positionMs by remember(bridge) { mutableLongStateOf(0L) }
    var durationMs by remember(bridge) { mutableLongStateOf(0L) }
    var playing by remember(bridge) { mutableStateOf(false) }
    var playbackSpeed by remember(bridge) { mutableFloatStateOf(1f) }
    var resizeMode by remember(bridge) { mutableIntStateOf(0) }
    var trackPanel by remember(bridge) { mutableStateOf<Int?>(null) }
    var audioTracks by remember(bridge) { mutableStateOf<List<IosTrack>>(emptyList()) }
    var subtitleTracks by remember(bridge) { mutableStateOf<List<IosTrack>>(emptyList()) }

    val encodedHeaders = remember(requestHeaders) {
        Json.encodeToString<Map<String, String>>(requestHeaders)
    }
    val encodedSubtitles = remember(subtitles) {
        Json.encodeToString(subtitles)
    }

    LaunchedEffect(bridge, url, encodedHeaders, encodedSubtitles, startPositionMs) {
        url?.takeIf(String::isNotBlank)?.let {
            bridge.loadFile(
                url = it,
                initialPositionMs = startPositionMs.coerceAtLeast(0),
                headersJson = encodedHeaders,
                subtitlesJson = encodedSubtitles,
            )
            if (active) bridge.play() else bridge.pause()
        }
    }

    LaunchedEffect(bridge, active) {
        if (active) bridge.play() else bridge.pause()
    }

    LaunchedEffect(bridge, resizeMode) {
        bridge.setResizeMode(resizeMode)
    }

    LaunchedEffect(bridge, preferredAudioLanguage) {
        bridge.setPreferredAudioLanguage(preferredAudioLanguage)
    }

    LaunchedEffect(controlsVisible) {
        latestControlsCallback.value(controlsVisible)
    }

    LaunchedEffect(bridge) {
        while (isActive) {
            val next = PlaybackState(
                loading = bridge.getIsLoading(),
                playing = bridge.getIsPlaying(),
                positionMs = bridge.getPositionMs().coerceAtLeast(0),
                durationMs = bridge.getDurationMs().coerceAtLeast(0),
                ended = bridge.getIsEnded(),
                error = bridge.getErrorMessage().ifBlank { null },
            )
            currentCallback(next)
            if (!dragging) positionMs = next.positionMs
            durationMs = next.durationMs
            playing = next.playing
            playbackSpeed = bridge.getPlaybackSpeed()
            delay(500)
        }
    }

    LaunchedEffect(bridge, trackPanel) {
        if (trackPanel == null) return@LaunchedEffect
        while (isActive) {
            audioTracks = bridge.readAudioTracks()
            subtitleTracks = bridge.readSubtitleTracks()
            delay(500)
        }
    }

    LaunchedEffect(controlsVisible, playing) {
        if (controlsVisible && playing) {
            delay(4_000)
            controlsVisible = false
        }
    }

    DisposableEffect(bridge) {
        onDispose { bridge.destroy() }
    }

    Box(
        modifier
            .background(Color.Black)
            .pointerInput(bridge, resizeMode) {
                detectTransformGestures { _, _, zoom, _ ->
                    val next = when {
                        zoom > 1.04f -> 2
                        zoom < .96f -> 0
                        else -> resizeMode
                    }
                    if (next != resizeMode) resizeMode = next
                }
            }
            .pointerInput(bridge, touchGestures, holdToSpeed) {
                detectTapGestures(
                    onPress = {
                        if (holdToSpeed) {
                            coroutineScope {
                                val release = async { tryAwaitRelease() }
                                delay(450)
                                if (!release.isCompleted) {
                                    val previousSpeed = playbackSpeed
                                    bridge.setPlaybackSpeed(2f)
                                    release.await()
                                    bridge.setPlaybackSpeed(previousSpeed)
                                }
                            }
                        } else {
                            tryAwaitRelease()
                        }
                    },
                    onTap = { controlsVisible = !controlsVisible },
                    onDoubleTap = if (touchGestures) {
                        { offset ->
                            if (offset.x < size.width / 2f) bridge.seekBy(-10_000) else bridge.seekBy(10_000)
                            controlsVisible = true
                        }
                    } else null,
                )
            },
    ) {
        UIKitViewController(
            factory = { bridge.createPlayerViewController() },
            modifier = Modifier.fillMaxSize(),
        )

        if (controlsVisible) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = .42f)),
            ) {
                Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically) {
                    FilledIconButton(
                        onClick = {
                            if (playing) bridge.pause() else bridge.play()
                            controlsVisible = true
                        },
                        modifier = Modifier.size(64.dp),
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = Color.White,
                            contentColor = Color.Black,
                        ),
                    ) {
                        Icon(
                            if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            if (playing) "Pause" else "Play",
                            modifier = Modifier.size(38.dp),
                        )
                    }
                }

                Column(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                ) {
                    Slider(
                        value = (if (dragging) draggedPosition else positionMs).toFloat(),
                        onValueChange = {
                            dragging = true
                            draggedPosition = it.toLong()
                        },
                        onValueChangeFinished = {
                            bridge.seekTo(draggedPosition)
                            positionMs = draggedPosition
                            dragging = false
                            controlsVisible = true
                        },
                        valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.primary,
                            activeTrackColor = MaterialTheme.colorScheme.primary,
                            inactiveTrackColor = Color.White.copy(alpha = .35f),
                        ),
                        modifier = Modifier.height(30.dp),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        IosPlayerTimePill(formatPlayerTime(if (dragging) draggedPosition else positionMs))
                        IosPlayerTimePill(formatPlayerTime(durationMs))
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        IosPlayerBottomAction(Icons.Rounded.Speed, "${playbackSpeed.trimSpeed()}×") {
                            val speeds = listOf(.5f, .75f, 1f, 1.25f, 1.5f, 2f)
                            val index = speeds.indexOfFirst { it == playbackSpeed }.takeIf { it >= 0 } ?: 2
                            val next = speeds[(index + 1) % speeds.size]
                            bridge.setPlaybackSpeed(next)
                            playbackSpeed = next
                            controlsVisible = true
                        }
                        IosPlayerBottomAction(Icons.Rounded.Headphones, "Audio") {
                            trackPanel = 0
                            controlsVisible = true
                        }
                        IosPlayerBottomAction(Icons.Rounded.Subtitles, "Subtitles") {
                            trackPanel = 1
                            controlsVisible = true
                        }
                        if (hasEpisodes) {
                            IosPlayerBottomAction(Icons.Rounded.PlaylistPlay, "Episodes", onEpisodes)
                        }
                    }
                }
            }
        }

        trackPanel?.let { panel ->
            IosPlayerTrackPanel(
                title = if (panel == 0) "Audio tracks" else "Subtitle tracks",
                tracks = if (panel == 0) audioTracks else subtitleTracks,
                selectedId = (if (panel == 0) audioTracks else subtitleTracks).firstOrNull { it.selected }?.id,
                allowOff = panel == 1,
                onSelect = { trackId ->
                    if (panel == 0) bridge.selectAudioTrack(trackId) else bridge.selectSubtitleTrack(trackId)
                    trackPanel = null
                },
                onDismiss = { trackPanel = null },
            )
        }
    }
}

private fun IosPlayerBridge.readAudioTracks(): List<IosTrack> =
    (0 until getAudioTrackCount()).map { index ->
        IosTrack(
            id = getAudioTrackId(index),
            label = getAudioTrackLabel(index).ifBlank { "Audio ${index + 1}" },
            language = getAudioTrackLang(index),
            selected = isAudioTrackSelected(index),
        )
    }

private fun IosPlayerBridge.readSubtitleTracks(): List<IosTrack> =
    (0 until getSubtitleTrackCount()).map { index ->
        IosTrack(
            id = getSubtitleTrackId(index),
            label = getSubtitleTrackLabel(index).ifBlank { "Subtitle ${index + 1}" },
            language = getSubtitleTrackLang(index),
            selected = isSubtitleTrackSelected(index),
        )
    }

@Composable
private fun IosPlayerTimePill(value: String) {
    Surface(
        color = Color.Black.copy(alpha = .65f),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = .22f)),
    ) {
        Text(
            value,
            color = Color.White,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

@Composable
private fun IosPlayerBottomAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick) {
        Icon(icon, label, tint = Color.White)
        Spacer(Modifier.width(5.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun BoxScope.IosPlayerTrackPanel(
    title: String,
    tracks: List<IosTrack>,
    selectedId: Int?,
    allowOff: Boolean,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    Box(
        Modifier
            .matchParentSize()
            .background(Color.Black.copy(alpha = .32f))
            .clickable(onClick = onDismiss),
    )
    Surface(
        Modifier
            .align(Alignment.Center)
            .fillMaxWidth(.88f)
            .fillMaxHeight(.72f)
            .clickable(onClick = {}),
        color = Color(0xF21A1A1D),
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 20.dp,
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = Color.White, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Rounded.Close, "Close", tint = Color.White)
                }
            }
            if (tracks.isEmpty() && !allowOff) {
                Text("No tracks were reported by mpv yet.", color = Color.White.copy(alpha = .65f))
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (allowOff) {
                        item {
                            IosPlayerTrackRow("Off", selectedId == null) { onSelect(-1) }
                        }
                    }
                    items(tracks, key = { it.id }) { track ->
                        IosPlayerTrackRow(
                            label = listOf(track.label, track.language).filter(String::isNotBlank).joinToString(" · "),
                            selected = track.id == selectedId,
                            onClick = { onSelect(track.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun IosPlayerTrackRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .18f) else Color.White.copy(alpha = .05f),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = Color.White, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Rounded.Check, "Selected", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

private fun Float.trimSpeed(): String =
    if (this % 1f == 0f) toInt().toString() else "%.2f".format(this)

private fun formatPlayerTime(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1_000).coerceAtLeast(0)
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}
