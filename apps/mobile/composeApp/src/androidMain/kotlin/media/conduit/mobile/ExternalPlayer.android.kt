package media.conduit.mobile

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Opens the stream with ACTION_VIEW so Android offers VLC, mpv, MX Player, or
 * the user's default. `title`, `position`, and `headers` are the extras those players read.
 */
@Composable
internal actual fun rememberExternalPlayerLauncher(): ((ExternalPlayerRequest) -> Boolean)? {
    val context = LocalContext.current
    return remember(context) {
        { request ->
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(Uri.parse(request.url), "video/*")
                .putExtra("title", request.title)
                .putExtra("position", request.startPositionMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
            if (request.requestHeaders.isNotEmpty()) {
                intent.putExtra("headers", request.requestHeaders.flatMap { (key, value) -> listOf(key, value) }.toTypedArray())
            }
            try {
                context.startActivity(intent)
                true
            } catch (_: ActivityNotFoundException) {
                false
            }
        }
    }
}
