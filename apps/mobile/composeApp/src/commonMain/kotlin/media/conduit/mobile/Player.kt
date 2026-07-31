package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
expect fun NativePlayer(
    url: String?,
    active: Boolean,
    startPositionMs: Long = 0,
    requestHeaders: Map<String, String> = emptyMap(),
    modifier: Modifier = Modifier,
    onState: (PlaybackState) -> Unit,
)
