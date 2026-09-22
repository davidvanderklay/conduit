package media.conduit.mobile

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

internal const val NOW_PLAYING_CHANNEL_ID = "conduit_playback"
internal const val NOW_PLAYING_NOTIFICATION_ID = 0x434F
private const val ACTION_START_FOREGROUND = "media.conduit.mobile.nowplaying.START"

class PlayerNowPlayingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_START_FOREGROUND) {
            PlayerNowPlayingServiceState.startRequested.set(false)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val notification = PlayerNowPlayingServiceState.notification
        if (notification == null) {
            PlayerNowPlayingServiceState.startRequested.set(false)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        startForeground(NOW_PLAYING_NOTIFICATION_ID, notification)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        PlayerNowPlayingServiceState.startRequested.set(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        super.onDestroy()
    }

    companion object {
        fun publish(context: Context, notification: Notification) {
            val appContext = context.applicationContext
            PlayerNowPlayingServiceState.notification = notification
            if (PlayerNowPlayingServiceState.startRequested.compareAndSet(false, true)) {
                val intent = Intent(appContext, PlayerNowPlayingService::class.java)
                    .setAction(ACTION_START_FOREGROUND)
                runCatching {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        appContext.startForegroundService(intent)
                    } else {
                        appContext.startService(intent)
                    }
                }.onFailure { error ->
                    PlayerNowPlayingServiceState.startRequested.set(false)
                    Log.w("ConduitNowPlaying", "Could not start the playback service", error)
                }
            }
            runCatching {
                appContext.getSystemService(NotificationManager::class.java)
                    ?.notify(NOW_PLAYING_NOTIFICATION_ID, notification)
            }.onFailure { error ->
                Log.w("ConduitNowPlaying", "Could not publish playback controls", error)
            }
        }

        fun hide(context: Context) {
            val appContext = context.applicationContext
            PlayerNowPlayingServiceState.notification = null
            PlayerNowPlayingServiceState.startRequested.set(false)
            appContext.stopService(Intent(appContext, PlayerNowPlayingService::class.java))
            appContext.getSystemService(NotificationManager::class.java)
                ?.cancel(NOW_PLAYING_NOTIFICATION_ID)
        }
    }
}

private object PlayerNowPlayingServiceState {
    val startRequested = AtomicBoolean(false)

    @Volatile
    var notification: Notification? = null
}
