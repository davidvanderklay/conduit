package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import conduit_mobile.composeapp.generated.resources.*
import media.conduit.mobile.account.ProfileSyncState
import media.conduit.mobile.account.SyncIssue
import org.jetbrains.compose.resources.stringResource

/** A stationary status row above cached content, with a full-sized retry target. */
@Composable
internal fun SyncStatusRow(state: ProfileSyncState, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    if (state.issue == null && !state.offline) return
    Column(modifier.fillMaxWidth().background(Color.Black)) {
        HorizontalDivider(color = Color.White.copy(alpha = .25f))
        Row(Modifier.fillMaxWidth().padding(start = 10.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(vertical = 8.dp).semantics(mergeDescendants = true) {}) {
                Text(stringResource(when (state.issue) {
                    SyncIssue.Authentication -> Res.string.sync_authentication
                    SyncIssue.Server -> Res.string.sync_server_error
                    else -> Res.string.sync_offline
                }), color = Color.White, style = MaterialTheme.typography.bodyMedium)
                Text(state.lastSyncedAt?.let { stringResource(Res.string.sync_saved_at, formatSavedAt(it)) }
                    ?: stringResource(if (state.snapshot == null) Res.string.sync_no_cache else Res.string.sync_saved_unknown), color = Color.White, style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onRetry, enabled = !state.refreshing, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(if (state.refreshing) Res.string.sync_refreshing else Res.string.sync_retry))
            }
        }
        HorizontalDivider(color = Color.White.copy(alpha = .25f))
    }
}

internal expect fun formatSavedAt(timestamp: String): String
