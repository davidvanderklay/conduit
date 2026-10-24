package media.conduit.mobile

import androidx.compose.runtime.Composable

internal const val ExternalPlayerDescription = "Open direct sources in VLC, mpv, or another app. P2P sources and watch parties stay in Conduit."

/** A resolved direct stream handed to another installed player. */
internal data class ExternalPlayerRequest(
    val url: String,
    val title: String,
    val requestHeaders: Map<String, String> = emptyMap(),
    val startPositionMs: Long = 0L,
)

/**
 * Returns a launcher on platforms that can open streams in other apps, or null
 * where that is unavailable. The launcher returns false when no app can play the stream.
 */
@Composable
internal expect fun rememberExternalPlayerLauncher(): ((ExternalPlayerRequest) -> Boolean)?
