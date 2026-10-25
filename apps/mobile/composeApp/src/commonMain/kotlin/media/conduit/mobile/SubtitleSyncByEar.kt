package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Hearing
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private enum class SyncMark { Heard, Saw }

/**
 * Floating card that sets the subtitle delay by ear. Tapping Heard when a line
 * is spoken and Saw when its subtitle appears, in either order, shifts the
 * delay by the gap between the two playback positions. It stays open so the
 * next line can refine the result. [positionMs] is read at each tap, so it
 * should query the player rather than return a polled position. TV players
 * pass [focusOnOpen] so the remote starts on Heard and stays in the card.
 */
@Composable
fun SubtitleSyncByEarCard(
    delayMs: Long,
    onDelayChange: (Long) -> Unit,
    positionMs: suspend () -> Long,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    focusOnOpen: Boolean = false,
) {
    val scope = rememberCoroutineScope()
    val latestDelay by rememberUpdatedState(delayMs)
    val latestDelayChange by rememberUpdatedState(onDelayChange)
    val latestPosition by rememberUpdatedState(positionMs)
    var pending by remember { mutableStateOf<Pair<SyncMark, Long>?>(null) }
    fun capture(mark: SyncMark) {
        scope.launch {
            val position = latestPosition()
            val first = pending
            if (first == null || first.first == mark) {
                pending = mark to position
                return@launch
            }
            pending = null
            val (heard, saw) = if (mark == SyncMark.Saw) first.second to position else position to first.second
            latestDelayChange(syncByEarDelay(latestDelay, heard, saw))
        }
    }
    val heardFocus = remember { FocusRequester() }
    if (focusOnOpen) LaunchedEffect(Unit) { heardFocus.requestFocusWhenReady() }

    Surface(
        modifier = modifier.widthIn(max = 340.dp).fillMaxWidth().focusTrap(focusOnOpen),
        color = Color(0xF20D0C12),
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 18.dp,
    ) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Sync by ear", color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Text(formatSubtitleDelay(delayMs), color = Color.White.copy(alpha = .78f))
                IconButton(onClick = onClose, modifier = Modifier.focusRing(CircleShape, Color.White)) {
                    Icon(Icons.Rounded.Close, "Close sync by ear", tint = Color.White)
                }
            }
            Row(Modifier.padding(end = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SyncMarkButton(Icons.Rounded.Hearing, "Heard", pending?.first == SyncMark.Heard, Modifier.weight(1f).focusRequester(heardFocus)) { capture(SyncMark.Heard) }
                SyncMarkButton(Icons.Rounded.Visibility, "Saw", pending?.first == SyncMark.Saw, Modifier.weight(1f)) { capture(SyncMark.Saw) }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                when (pending?.first) {
                    SyncMark.Heard -> "Now tap Saw when its subtitle appears."
                    SyncMark.Saw -> "Now tap Heard when the line is spoken."
                    null -> "Tap Heard when you hear a line and Saw when its subtitle appears."
                },
                modifier = Modifier.padding(end = 8.dp),
                color = Color.White.copy(alpha = .6f),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun SyncMarkButton(icon: ImageVector, label: String, marked: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    val contentColor = if (marked) Color.Black else Color.White
    Row(
        modifier
            .clip(shape)
            .background(if (marked) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = .1f))
            .focusRing(shape, Color.White)
            .clickable(onClick = onClick)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = contentColor, modifier = Modifier.size(20.dp))
        Text(label, color = contentColor, fontWeight = FontWeight.SemiBold)
    }
}
