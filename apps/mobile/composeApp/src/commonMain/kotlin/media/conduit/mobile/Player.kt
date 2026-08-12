package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import media.conduit.mobile.account.SubtitleItem

@Composable
expect fun PlayerOrientationLock(active: Boolean)

@Composable
expect fun NativePlayer(
    url: String?,
    active: Boolean,
    startPositionMs: Long = 0,
    requestHeaders: Map<String, String> = emptyMap(),
    subtitles: List<SubtitleItem> = emptyList(),
    contentLogo: String? = null,
    contentTitle: String? = null,
    hasNextEpisode: Boolean = false,
    onNextEpisode: () -> Unit = {},
    hasEpisodes: Boolean = false,
    touchGestures: Boolean = true,
    holdToSpeed: Boolean = true,
    preferredAudioLanguage: String = "System default",
    preferredSubtitleLanguage: String = "English",
    onEpisodes: () -> Unit = {},
    onControlsVisibilityChanged: (Boolean) -> Unit = {},
    onTemporarySpeedChanged: (Boolean) -> Unit = {},
    modifier: Modifier = Modifier,
    onState: (PlaybackState) -> Unit,
)
