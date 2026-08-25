package media.conduit.client

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import media.conduit.client.account.SubtitleItem

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
    onControlsVisibilityChanged: (Boolean) -> Unit,
    onOverlayVisibilityChanged: (Boolean) -> Unit,
    onTemporarySpeedChanged: (Boolean) -> Unit,
    onSystemPipChanged: (Boolean) -> Unit,
    onSystemPipAvailabilityChanged: (Boolean) -> Unit,
    interactiveResize: Boolean,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val message = "Browser playback is not connected yet"
    LaunchedEffect(active, url) {
        onSystemPipAvailabilityChanged(false)
        onState(PlaybackState(loading = false, error = if (active && url != null) message else null))
    }
    Box(modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        if (active && url != null) {
            Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
