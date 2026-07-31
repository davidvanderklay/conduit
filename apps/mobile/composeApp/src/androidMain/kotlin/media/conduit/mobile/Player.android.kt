package media.conduit.mobile

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.annotation.OptIn
import androidx.compose.runtime.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay

@OptIn(UnstableApi::class)
@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    hasEpisodes: Boolean,
    onEpisodes: () -> Unit,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val activity = context as? Activity
    val currentCallback by rememberUpdatedState(onState)
    val player = remember(url, requestHeaders) {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("Conduit Mobile")
            .setDefaultRequestProperties(requestHeaders)
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        ExoPlayer.Builder(context, renderers).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build()
    }
    var playbackError by remember(player) { mutableStateOf<String?>(null) }
    var controlsVisible by remember(player) { mutableStateOf(true) }
    var positionMs by remember(player) { mutableLongStateOf(0L) }
    var durationMs by remember(player) { mutableLongStateOf(0L) }
    var playing by remember(player) { mutableStateOf(false) }
    var dragging by remember(player) { mutableStateOf(false) }
    var draggedPosition by remember(player) { mutableFloatStateOf(0f) }
    var trackPanel by remember { mutableStateOf<Int?>(null) }
    var tracksRevision by remember { mutableIntStateOf(0) }

    DisposableEffect(player, url) {
        val previousOrientation = activity?.requestedOrientation
        var resumed = false
        val listener = object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                playbackError = when (error.errorCode) {
                    androidx.media3.common.PlaybackException.ERROR_CODE_DECODING_FAILED,
                    androidx.media3.common.PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
                    -> "This device cannot decode this stream's video format. Try a 1080p H.264/AVC stream or a physical device with HEVC support."
                    else -> error.cause?.message ?: error.message
                }
            }
            override fun onTracksChanged(tracks: Tracks) { tracksRevision++ }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && !resumed) {
                    resumed = true
                    val duration = player.duration.coerceAtLeast(0)
                    if (startPositionMs > 0 && startPositionMs < duration - 5_000) player.seekTo(startPositionMs)
                    activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                }
            }
            override fun onRenderedFirstFrame() {
                activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            }
        }
        player.addListener(listener)
        if (url != null) {
            val item = MediaItem.Builder().setUri(url).apply {
                val lower = url.lowercase().substringBefore('#')
                when {
                    ".m3u8" in lower || "format=m3u8" in lower -> setMimeType(MimeTypes.APPLICATION_M3U8)
                    ".mpd" in lower || "format=mpd" in lower -> setMimeType(MimeTypes.APPLICATION_MPD)
                    ".ism" in lower || ".isml" in lower -> setMimeType(MimeTypes.APPLICATION_SS)
                }
            }.build()
            player.setMediaItem(item)
            player.prepare()
            player.playWhenReady = active
        }
        onDispose {
            player.removeListener(listener)
            player.release()
            if (previousOrientation != null) activity.requestedOrientation = previousOrientation
        }
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(player, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                currentCallback(
                    PlaybackState(
                        loading = player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_IDLE,
                        playing = player.isPlaying,
                        positionMs = player.currentPosition.coerceAtLeast(0),
                        durationMs = player.duration.coerceAtLeast(0),
                        ended = player.playbackState == Player.STATE_ENDED,
                        error = playbackError,
                    ),
                )
                if (!dragging) positionMs = player.currentPosition.coerceAtLeast(0)
                durationMs = player.duration.coerceAtLeast(0)
                playing = player.isPlaying
                delay(500)
            }
        }
    }
    LaunchedEffect(controlsVisible, playing) {
        if (controlsVisible && playing) {
            delay(4_000)
            controlsVisible = false
        }
    }

    Box(modifier.background(Color.Black).clickable { controlsVisible = !controlsVisible }) {
        AndroidView(
            factory = { PlayerView(it).apply { this.player = player; useController = false; setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS); keepScreenOn = true } },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize(),
        )
        if (controlsVisible) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .42f)).clickable { controlsVisible = true }) {
                Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
                    PlayerControlButton(Icons.Rounded.Replay10, "Back 10 seconds") { player.seekBack(); controlsVisible = true }
                    FilledIconButton(onClick = { if (player.isPlaying) player.pause() else player.play(); controlsVisible = true }, modifier = Modifier.size(64.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White, contentColor = Color.Black)) {
                        Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause" else "Play", modifier = Modifier.size(38.dp))
                    }
                    PlayerControlButton(Icons.Rounded.Forward10, "Forward 10 seconds") { player.seekForward(); controlsVisible = true }
                }
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 22.dp, vertical = 14.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        PlayerTimePill(formatPlayerTime(if (dragging) draggedPosition.toLong() else positionMs))
                        PlayerTimePill(formatPlayerTime(durationMs))
                    }
                    Slider(
                        value = if (dragging) draggedPosition else positionMs.toFloat(),
                        onValueChange = { dragging = true; draggedPosition = it },
                        onValueChangeFinished = { player.seekTo(draggedPosition.toLong()); dragging = false; controlsVisible = true },
                        valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
                        colors = SliderDefaults.colors(thumbColor = MaterialTheme.colorScheme.primary, activeTrackColor = MaterialTheme.colorScheme.primary, inactiveTrackColor = Color.White.copy(.35f)),
                    )
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Spacer(Modifier.weight(1f))
                        val speeds = listOf(.5f, .75f, 1f, 1.25f, 1.5f, 2f)
                        TextButton(onClick = { val current = player.playbackParameters.speed; player.setPlaybackSpeed(speeds[(speeds.indexOfFirst { it == current }.takeIf { it >= 0 } ?: 1).let { (it + 1) % speeds.size }]); controlsVisible = true }) { Text("${player.playbackParameters.speed}×", color = Color.White) }
                        IconButton(onClick = { trackPanel = C.TRACK_TYPE_AUDIO; controlsVisible = true }) { Icon(Icons.Rounded.Headphones, "Audio tracks", tint = Color.White) }
                        IconButton(onClick = { trackPanel = C.TRACK_TYPE_TEXT; controlsVisible = true }) { Icon(Icons.Rounded.Subtitles, "Subtitles", tint = Color.White) }
                        if (hasEpisodes) IconButton(onClick = onEpisodes) { Icon(Icons.Rounded.PlaylistPlay, "Episodes", tint = Color.White) }
                    }
                }
            }
        }
        trackPanel?.let { type ->
            @Suppress("UNUSED_EXPRESSION") tracksRevision
            PlayerTrackPanel(player, type, onDismiss = { trackPanel = null })
        }
    }
}

@Composable
private fun PlayerTimePill(value: String) {
    Surface(color = Color.Black.copy(.65f), shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(.22f))) {
        Text(value, color = Color.White, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp), style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun BoxScope.PlayerTrackPanel(player: ExoPlayer, type: Int, onDismiss: () -> Unit) {
    val groups = player.currentTracks.groups.filter { it.type == type }
    Surface(modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(.48f), color = Color(0xF21A1A1D), shape = RoundedCornerShape(topStart = 28.dp, bottomStart = 28.dp), shadowElevation = 18.dp) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (type == C.TRACK_TYPE_AUDIO) "Audio" else "Subtitles", color = Color.White, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.weight(1f)); IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
            }
            Text(if (type == C.TRACK_TYPE_AUDIO) "Choose an audio language" else "Choose a subtitle language and variant", color = Color.White.copy(.6f))
            Spacer(Modifier.height(14.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (type == C.TRACK_TYPE_TEXT) item {
                    PlayerTrackRow("Off", !groups.any { it.isSelected }) {
                        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(type).setTrackTypeDisabled(type, true).build(); onDismiss()
                    }
                }
                groups.forEach { group ->
                    items((0 until group.length).toList()) { index ->
                        val format = group.getTrackFormat(index)
                        val language = format.label ?: format.language?.let { java.util.Locale.forLanguageTag(it).displayLanguage } ?: if (type == C.TRACK_TYPE_AUDIO) "Audio track ${index + 1}" else "Subtitle ${index + 1}"
                        val detail = listOfNotNull(format.language?.uppercase(), format.roleFlags.takeIf { it != 0 }?.let { "Variant ${index + 1}" }).joinToString(" · ")
                        PlayerTrackRow(listOf(language, detail).filter { it.isNotBlank() }.joinToString("  "), group.isTrackSelected(index)) {
                            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(type, false).clearOverridesOfType(type).addOverride(TrackSelectionOverride(group.mediaTrackGroup, index)).build(); onDismiss()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerTrackRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, color = if (selected) MaterialTheme.colorScheme.primary.copy(.18f) else Color.White.copy(.06f), shape = RoundedCornerShape(14.dp), border = if (selected) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Text(label, color = Color.White, modifier = Modifier.weight(1f)); if (selected) Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) }
    }
}

@Composable
private fun PlayerControlButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(54.dp)) { Icon(icon, label, tint = Color.White, modifier = Modifier.size(36.dp)) }
}

private fun formatPlayerTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1_000
    val hours = seconds / 3_600
    val minutes = seconds % 3_600 / 60
    val remainder = seconds % 60
    return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}" else "$minutes:${remainder.toString().padStart(2, '0')}"
}
