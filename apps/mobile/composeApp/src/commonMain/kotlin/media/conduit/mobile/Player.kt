package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
expect fun NativePlayer(
    url: String?,
    active: Boolean,
    modifier: Modifier = Modifier,
    onState: (PlaybackState) -> Unit,
)
