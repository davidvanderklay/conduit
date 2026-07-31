package media.conduit.mobile

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.interop.UIKitView
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.delay
import platform.AVFoundation.*
import platform.CoreMedia.CMTimeGetSeconds
import platform.CoreMedia.CMTimeMakeWithSeconds
import platform.Foundation.NSURL
import platform.Foundation.NSNotificationCenter
import platform.UIKit.UIView
import platform.UIKit.UIApplicationDidEnterBackgroundNotification

@OptIn(ExperimentalForeignApi::class)
private class PlayerContainer : UIView() {
    val playerLayer = AVPlayerLayer()

    init {
        layer.addSublayer(playerLayer)
    }

    override fun layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }
}

@OptIn(ExperimentalForeignApi::class)
@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val currentCallback by rememberUpdatedState(onState)
    val player = remember { AVPlayer() }

    DisposableEffect(player, url, active) {
        val item = url?.let(NSURL::URLWithString)?.let { AVPlayerItem(URL = it) }
        player.replaceCurrentItemWithPlayerItem(item)
        if (startPositionMs > 0) player.seekToTime(CMTimeMakeWithSeconds(startPositionMs / 1000.0, 600))
        if (active && item != null) player.play() else player.pause()
        onDispose {
            player.pause()
            player.replaceCurrentItemWithPlayerItem(null)
        }
    }
    DisposableEffect(player) {
        val center = NSNotificationCenter.defaultCenter
        val backgroundObserver = center.addObserverForName(
            name = UIApplicationDidEnterBackgroundNotification,
            `object` = null,
            queue = null,
        ) { player.pause() }
        onDispose { center.removeObserver(backgroundObserver) }
    }
    LaunchedEffect(player) {
        while (true) {
            val position = CMTimeGetSeconds(player.currentTime())
            val duration = player.currentItem?.duration?.let(::CMTimeGetSeconds) ?: 0.0
            currentCallback(
                PlaybackState(
                    loading = duration <= 0.0,
                    playing = player.rate != 0f,
                    positionMs = if (position.isFinite()) (position * 1000).toLong() else 0,
                    durationMs = if (duration.isFinite()) (duration * 1000).toLong() else 0,
                ),
            )
            delay(500)
        }
    }
    UIKitView(
        factory = { PlayerContainer().apply { playerLayer.player = player } },
        update = { it.playerLayer.player = player },
        modifier = modifier,
    )
}
