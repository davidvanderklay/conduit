package media.conduit.mobile

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.res.Configuration
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.os.Bundle
import android.content.Intent
import android.os.Build
import android.util.Rational
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import android.graphics.Color
import androidx.activity.compose.setContent
import media.conduit.mobile.account.MobileOAuthCallbacks
import androidx.media3.common.Player
import java.lang.ref.WeakReference

class MainActivity : ComponentActivity() {
    private var pipPlayer: Player? = null
    private var pipSourceView = WeakReference<View>(null)
    private var pipActive = false
    private var videoWidth = 16
    private var videoHeight = 9
    private var onPipModeChanged: ((Boolean) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        MobileOAuthCallbacks.capture(intent)
        setContent { App() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_TOGGLE_PLAYBACK) {
            pipPlayer?.let { player -> if (player.isPlaying) player.pause() else player.play() }
            updateConduitPictureInPictureParams()
            return
        }
        MobileOAuthCallbacks.capture(intent)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && pipActive && pipPlayer?.isPlaying == true) {
            enterConduitPictureInPicture()
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        onPipModeChanged?.invoke(isInPictureInPictureMode)
    }

    internal fun attachConduitPipPlayer(
        player: Player,
        onModeChanged: (Boolean) -> Unit,
    ) {
        pipPlayer = player
        onPipModeChanged = onModeChanged
        pipActive = true
        updateConduitPictureInPictureParams()
    }

    internal fun detachConduitPipPlayer(player: Player) {
        if (pipPlayer !== player) return
        pipPlayer = null
        onPipModeChanged = null
        pipSourceView.clear()
        pipActive = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setPictureInPictureParams(
                PictureInPictureParams.Builder().setAutoEnterEnabled(false).build(),
            )
        }
    }

    internal fun setConduitPipSourceView(view: View) {
        pipSourceView = WeakReference(view)
        updateConduitPictureInPictureParams()
    }

    internal fun updateConduitPipVideoSize(width: Int, height: Int) {
        if (width > 0 && height > 0) {
            videoWidth = width
            videoHeight = height
        }
        updateConduitPictureInPictureParams()
    }

    internal fun updateConduitPictureInPictureParams() {
        if (!pipActive || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val sourceRect = Rect().takeIf { pipSourceView.get()?.getGlobalVisibleRect(it) == true }
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(clampedPipAspectRatio(videoWidth, videoHeight))
            .setActions(listOf(playPauseAction()))
        sourceRect?.let(builder::setSourceRectHint)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(pipPlayer?.isPlaying == true)
            builder.setSeamlessResizeEnabled(true)
        }
        setPictureInPictureParams(builder.build())
    }

    internal fun enterConduitPictureInPicture() {
        if (!pipActive || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val sourceRect = Rect().takeIf { pipSourceView.get()?.getGlobalVisibleRect(it) == true }
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(clampedPipAspectRatio(videoWidth, videoHeight))
            .setActions(listOf(playPauseAction()))
        sourceRect?.let(builder::setSourceRectHint)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setSeamlessResizeEnabled(true)
        enterPictureInPictureMode(builder.build())
    }

    private fun playPauseAction(): RemoteAction {
        val playing = pipPlayer?.isPlaying == true
        val intent = Intent(this, MainActivity::class.java).apply { action = ACTION_TOGGLE_PLAYBACK }
        val pendingIntent = PendingIntent.getActivity(
            this,
            1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return RemoteAction(
            Icon.createWithResource(this, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
            if (playing) "Pause" else "Play",
            if (playing) "Pause playback" else "Play playback",
            pendingIntent,
        )
    }

    companion object {
        private const val ACTION_TOGGLE_PLAYBACK = "media.conduit.mobile.action.TOGGLE_PLAYBACK"
    }
}

internal fun clampedPipAspectRatio(width: Int, height: Int): Rational {
    val (numerator, denominator) = clampPipAspectRatio(width, height)
    return Rational(numerator, denominator)
}
