package media.conduit.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState as SystemPlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

private const val SEEK_INTERVAL_MS = 10_000L
private const val MAX_ARTWORK_BYTES = 12 * 1024 * 1024
private const val MAX_ARTWORK_EDGE = 1_024
private const val ACTION_PLAY = "media.conduit.mobile.nowplaying.PLAY"
private const val ACTION_PAUSE = "media.conduit.mobile.nowplaying.PAUSE"
private const val ACTION_REWIND = "media.conduit.mobile.nowplaying.REWIND"
private const val ACTION_FAST_FORWARD = "media.conduit.mobile.nowplaying.FAST_FORWARD"

internal data class AndroidNowPlayingMetadata(
    val title: String,
    val subtitle: String?,
    val artworkUrl: String?,
)

internal data class AndroidNowPlayingSnapshot(
    val loading: Boolean = true,
    val playing: Boolean = false,
    val ended: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val playbackSpeed: Float = 1f,
)

internal class AndroidPlayerNowPlayingController(
    context: Context,
    private val controls: Controls,
) {
    internal data class Controls(
        val play: () -> Unit,
        val pause: () -> Unit,
        val seekTo: (Long) -> Unit,
        val seekBy: (Long) -> Unit,
    )

    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val artworkExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "ConduitNowPlayingArtwork").apply { isDaemon = true }
    }
    private val artworkGeneration = AtomicInteger()
    private val mediaSession = MediaSession(appContext, "ConduitNowPlaying").apply {
        setCallback(
            object : MediaSession.Callback() {
                override fun onPlay() = controls.play()
                override fun onPause() = controls.pause()
                override fun onStop() = controls.pause()
                override fun onSeekTo(pos: Long) = controls.seekTo(pos.coerceAtLeast(0))
                override fun onFastForward() = controls.seekBy(SEEK_INTERVAL_MS)
                override fun onRewind() = controls.seekBy(-SEEK_INTERVAL_MS)
            },
            mainHandler,
        )
        buildContentIntent(appContext)?.let(::setSessionActivity)
    }
    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY) controls.pause()
        }
    }

    private var metadata: AndroidNowPlayingMetadata? = null
    private var snapshot = AndroidNowPlayingSnapshot()
    private var artwork: Bitmap? = null
    private var released = false
    private var receiverRegistered = false
    private var lastPublishedPosition = Long.MIN_VALUE
    private var lastPublishedPlaying: Boolean? = null
    private var lastPublishedLoading: Boolean? = null
    private var lastPublishedEnded: Boolean? = null
    private var lastPublishedDuration = Long.MIN_VALUE
    private var lastPublishedSpeed = Float.NaN

    val isActive: Boolean
        get() = !released && metadata != null

    init {
        createNotificationChannel()
        AndroidNowPlayingActionDispatcher.register(this)
        registerNoisyReceiver()
    }

    fun updateMetadata(title: String?, subtitle: String?, artworkUrl: String?) {
        runOnMain {
            val normalizedTitle = title?.trim().orEmpty()
            if (released || normalizedTitle.isEmpty()) {
                clearInternal()
                return@runOnMain
            }
            val next = AndroidNowPlayingMetadata(
                title = normalizedTitle,
                subtitle = subtitle?.trim()?.takeIf(String::isNotEmpty),
                artworkUrl = artworkUrl?.trim()?.takeIf(String::isNotEmpty),
            )
            val artworkChanged = metadata?.artworkUrl != next.artworkUrl
            metadata = next
            mediaSession.isActive = true
            if (artworkChanged) {
                artwork = null
                loadArtwork(next.artworkUrl)
            }
            publishMetadata()
            publishPlaybackState(force = true)
            publishNotification()
        }
    }

    fun syncPlayback(next: AndroidNowPlayingSnapshot) {
        runOnMain {
            if (released || metadata == null) return@runOnMain
            val notificationChanged = snapshot.playing != next.playing ||
                snapshot.loading != next.loading || snapshot.ended != next.ended
            val durationChanged = snapshot.durationMs != next.durationMs
            snapshot = next
            if (durationChanged) publishMetadata()
            publishPlaybackState(force = false)
            if (notificationChanged) publishNotification()
        }
    }

    fun release() {
        runOnMain {
            if (released) return@runOnMain
            clearInternal()
            released = true
            AndroidNowPlayingActionDispatcher.unregister(this)
            if (receiverRegistered) appContext.unregisterReceiver(noisyReceiver)
            receiverRegistered = false
            mediaSession.release()
            artworkExecutor.shutdownNow()
        }
    }

    internal fun handleAction(action: String?) {
        when (action) {
            ACTION_PLAY -> controls.play()
            ACTION_PAUSE -> controls.pause()
            ACTION_REWIND -> controls.seekBy(-SEEK_INTERVAL_MS)
            ACTION_FAST_FORWARD -> controls.seekBy(SEEK_INTERVAL_MS)
        }
    }

    private fun clearInternal() {
        artworkGeneration.incrementAndGet()
        metadata = null
        snapshot = AndroidNowPlayingSnapshot()
        artwork = null
        mediaSession.setMetadata(null)
        mediaSession.setPlaybackState(
            SystemPlaybackState.Builder()
                .setState(SystemPlaybackState.STATE_NONE, 0, 0f)
                .build(),
        )
        mediaSession.isActive = false
        PlayerNowPlayingService.hide(appContext)
    }

    private fun publishMetadata() {
        val current = metadata ?: return
        mediaSession.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, current.title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, current.title)
                .apply {
                    current.subtitle?.let {
                        putString(MediaMetadata.METADATA_KEY_ARTIST, it)
                        putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, it)
                    }
                    snapshot.durationMs.takeIf { it > 0 }?.let {
                        putLong(MediaMetadata.METADATA_KEY_DURATION, it)
                    }
                    artwork?.takeUnless(Bitmap::isRecycled)?.let {
                        putBitmap(MediaMetadata.METADATA_KEY_ART, it)
                        putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
                    }
                }
                .build(),
        )
    }

    private fun publishPlaybackState(force: Boolean) {
        val current = snapshot
        val changed = abs(current.positionMs - lastPublishedPosition) >= 1_000 ||
            current.playing != lastPublishedPlaying || current.loading != lastPublishedLoading ||
            current.ended != lastPublishedEnded || current.durationMs != lastPublishedDuration ||
            current.playbackSpeed != lastPublishedSpeed
        if (!force && !changed) return

        val state = when {
            current.ended -> SystemPlaybackState.STATE_STOPPED
            current.loading -> SystemPlaybackState.STATE_BUFFERING
            current.playing -> SystemPlaybackState.STATE_PLAYING
            else -> SystemPlaybackState.STATE_PAUSED
        }
        val actions = SystemPlaybackState.ACTION_PLAY or SystemPlaybackState.ACTION_PAUSE or
            SystemPlaybackState.ACTION_PLAY_PAUSE or SystemPlaybackState.ACTION_STOP or
            SystemPlaybackState.ACTION_SEEK_TO or SystemPlaybackState.ACTION_FAST_FORWARD or
            SystemPlaybackState.ACTION_REWIND
        mediaSession.setPlaybackState(
            SystemPlaybackState.Builder()
                .setActions(actions)
                .setState(
                    state,
                    current.positionMs.coerceAtLeast(0),
                    if (current.playing) current.playbackSpeed.coerceAtLeast(.1f) else 0f,
                    SystemClock.elapsedRealtime(),
                )
                .build(),
        )
        lastPublishedPosition = current.positionMs
        lastPublishedPlaying = current.playing
        lastPublishedLoading = current.loading
        lastPublishedEnded = current.ended
        lastPublishedDuration = current.durationMs
        lastPublishedSpeed = current.playbackSpeed
    }

    private fun publishNotification() {
        val current = metadata ?: return
        PlayerNowPlayingService.publish(
            appContext,
            buildNotification(appContext, mediaSession.sessionToken, current, snapshot, artwork),
        )
    }

    private fun loadArtwork(urlString: String?) {
        val generation = artworkGeneration.incrementAndGet()
        if (urlString == null) return
        artworkExecutor.execute {
            val next = runCatching { downloadArtwork(urlString) }.getOrNull()
            mainHandler.post {
                if (released || generation != artworkGeneration.get() || metadata?.artworkUrl != urlString) return@post
                artwork = next
                publishMetadata()
                publishNotification()
            }
        }
    }

    private fun registerNoisyReceiver() {
        val filter = IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            appContext.registerReceiver(noisyReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            NOW_PLAYING_CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Video playback controls"
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        appContext.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }
}

class PlayerNowPlayingActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        AndroidNowPlayingActionDispatcher.dispatch(intent?.action)
    }
}

private object AndroidNowPlayingActionDispatcher {
    private var controller = WeakReference<AndroidPlayerNowPlayingController>(null)

    fun register(next: AndroidPlayerNowPlayingController) {
        controller = WeakReference(next)
    }

    fun unregister(current: AndroidPlayerNowPlayingController) {
        if (controller.get() === current) controller.clear()
    }

    fun dispatch(action: String?) {
        controller.get()?.handleAction(action)
    }
}

private fun buildNotification(
    context: Context,
    sessionToken: MediaSession.Token,
    metadata: AndroidNowPlayingMetadata,
    snapshot: AndroidNowPlayingSnapshot,
    artwork: Bitmap?,
): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, NOW_PLAYING_CHANNEL_ID)
    } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
    }
    val playPause = if (snapshot.playing) {
        Notification.Action.Builder(
            Icon.createWithResource(context, android.R.drawable.ic_media_pause),
            "Pause",
            actionIntent(context, ACTION_PAUSE, 2),
        ).build()
    } else {
        Notification.Action.Builder(
            Icon.createWithResource(context, android.R.drawable.ic_media_play),
            "Play",
            actionIntent(context, ACTION_PLAY, 2),
        ).build()
    }
    return builder
        .setSmallIcon(R.drawable.ic_notification_playback)
        .setContentTitle(metadata.title)
        .setContentText(metadata.subtitle)
        .setLargeIcon(artwork?.takeUnless(Bitmap::isRecycled))
        .setContentIntent(buildContentIntent(context))
        .setCategory(Notification.CATEGORY_TRANSPORT)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setOnlyAlertOnce(true)
        .setOngoing(snapshot.playing)
        .setShowWhen(false)
        .addAction(Notification.Action.Builder(Icon.createWithResource(context, android.R.drawable.ic_media_rew), "Rewind 10 seconds", actionIntent(context, ACTION_REWIND, 1)).build())
        .addAction(playPause)
        .addAction(Notification.Action.Builder(Icon.createWithResource(context, android.R.drawable.ic_media_ff), "Forward 10 seconds", actionIntent(context, ACTION_FAST_FORWARD, 3)).build())
        .setStyle(Notification.MediaStyle().setMediaSession(sessionToken).setShowActionsInCompactView(0, 1, 2))
        .build()
}

private fun actionIntent(context: Context, action: String, requestCode: Int): PendingIntent =
    PendingIntent.getBroadcast(
        context,
        requestCode,
        Intent(context, PlayerNowPlayingActionReceiver::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

private fun buildContentIntent(context: Context): PendingIntent? = PendingIntent.getActivity(
    context,
    0,
    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
)

private fun downloadArtwork(urlString: String): Bitmap? {
    val connection = URL(urlString).openConnection() as? HttpURLConnection ?: return null
    connection.connectTimeout = 10_000
    connection.readTimeout = 15_000
    connection.instanceFollowRedirects = true
    return try {
        connection.connect()
        if (connection.responseCode !in 200..299) return null
        val bytes = connection.inputStream.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_ARTWORK_BYTES) return null
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sampleSize = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_ARTWORK_EDGE) sampleSize *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sampleSize })
    } finally {
        connection.disconnect()
    }
}

internal fun shouldPauseAndroidPlaybackOnStop(
    isInPictureInPicture: Boolean,
    activityIsFinishing: Boolean,
    hasActiveNowPlayingSession: Boolean,
): Boolean = activityIsFinishing || (!isInPictureInPicture && !hasActiveNowPlayingSession)
