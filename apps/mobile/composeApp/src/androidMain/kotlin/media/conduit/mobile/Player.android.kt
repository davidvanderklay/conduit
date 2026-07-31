package media.conduit.mobile

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.annotation.OptIn
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
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
        ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build()
    }

    DisposableEffect(player, url) {
        val previousOrientation = activity?.requestedOrientation
        var resumed = false
        val listener = object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                currentCallback(PlaybackState(loading = false, error = error.cause?.message ?: error.message))
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && !resumed) {
                    resumed = true
                    val duration = player.duration.coerceAtLeast(0)
                    if (startPositionMs > 0 && startPositionMs < duration - 5_000) player.seekTo(startPositionMs)
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
                    ),
                )
                delay(500)
            }
        }
    }

    AndroidView(
        factory = { PlayerView(it).apply { this.player = player; setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS); controllerShowTimeoutMs = 3500; controllerAutoShow = true; keepScreenOn = true } },
        update = { it.player = player },
        modifier = modifier,
    )
}
