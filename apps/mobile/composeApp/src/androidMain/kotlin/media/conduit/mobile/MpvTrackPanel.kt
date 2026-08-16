package media.conduit.mobile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.media3.common.C

@Composable
internal fun BoxScope.MpvTrackPanel(
    view: ConduitMpvView,
    type: Int,
    revision: Int,
    onSubtitleSelectionChanged: (String?, String?, String?, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val tracks = remember(view, type, revision) {
        view.tracks(if (type == C.TRACK_TYPE_AUDIO) "audio" else "sub")
    }
    Surface(
        modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(.48f),
        color = Color(0xF21A1A1D),
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (type == C.TRACK_TYPE_AUDIO) "Audio" else "Subtitles",
                    color = Color.White,
                    style = MaterialTheme.typography.headlineSmall,
                )
                Spacer(Modifier.width(8.dp))
                Text("libmpv", color = Color.White.copy(alpha = .5f), style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
            }
            Text(
                if (type == C.TRACK_TYPE_AUDIO) "Choose an audio track" else "Choose a subtitle track",
                color = Color.White.copy(alpha = .6f),
            )
            LazyColumn(
                modifier = Modifier.padding(top = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (type == C.TRACK_TYPE_TEXT) {
                    item {
                        MpvTrackRow("Off", tracks.none { it.selected }) {
                            view.selectSubtitle(null, null, false)
                            onSubtitleSelectionChanged(null, null, null, false)
                            onDismiss()
                        }
                    }
                }
                items(tracks, key = { "${it.type}:${it.id}" }) { track ->
                    MpvTrackRow(
                        label = listOfNotNull(
                            track.label.takeIf(String::isNotBlank),
                            track.language?.takeIf(String::isNotBlank),
                            if (track.forced) "Forced" else null,
                        ).joinToString(" · "),
                        selected = track.selected,
                    ) {
                        if (type == C.TRACK_TYPE_AUDIO) {
                            view.selectAudio(track.id)
                        } else {
                            view.selectSubtitle(track.id, track.selectionKey, true)
                            onSubtitleSelectionChanged(track.selectionKey, track.language, track.label, true)
                        }
                        onDismiss()
                    }
                }
            }
        }
    }
}

@Composable
private fun MpvTrackRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .18f) else Color.White.copy(alpha = .06f),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
        border = if (selected) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null,
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label.ifBlank { "Track" }, color = Color.White, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
        }
    }
}
