package media.conduit.mobile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.StopCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.account.ProfileSummary
import media.conduit.mobile.account.WatchPartyMedia
import media.conduit.mobile.account.WatchPartySummary

@Composable
internal fun WatchPartySheet(
    open: Boolean,
    onDismiss: () -> Unit,
    api: ConduitApi,
    baseUrl: String,
    token: String,
    profile: ProfileSummary,
    media: WatchPartyMedia? = null,
) {
    if (!open) return
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var parties by remember(profile.id) { mutableStateOf<List<WatchPartySummary>>(emptyList()) }
    var active by remember(profile.id) { mutableStateOf<WatchPartySummary?>(null) }
    var inviteUrl by remember(profile.id) { mutableStateOf<String?>(null) }
    var inviteInput by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("private") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }

    fun refresh() {
        scope.launch {
            runCatching { api.listWatchParties(baseUrl, token, profile.id) }
                .onSuccess { parties = it }
                .onFailure { error = it.message ?: "Unable to load watch parties" }
        }
    }

    LaunchedEffect(open, profile.id) { if (open) refresh() }

    fun run(action: suspend () -> Unit) {
        loading = true
        error = null
        scope.launch {
            runCatching { action() }.onFailure { error = it.message ?: "Watch party request failed" }
            loading = false
        }
    }

    fun startParty() {
        val selected = media ?: return
        run {
            val result = api.createWatchParty(baseUrl, token, profile.id, mode, selected)
            active = result.party
            inviteUrl = result.invite?.url
            parties = listOf(result.party) + parties.filterNot { it.id == result.party.id }
        }
    }

    fun join(party: WatchPartySummary) {
        run {
            val result = api.joinWatchParty(baseUrl, token, party.id, profile.id)
            active = result.party
        }
    }

    fun accept() {
        if (inviteInput.isBlank()) return
        run {
            val inviteToken = inviteInput.trim().substringAfterLast('/').substringBefore('?')
            val result = api.acceptWatchPartyInvite(baseUrl, token, inviteToken, profile.id)
            active = result.party
        }
    }

    fun leave() {
        val party = active ?: return
        run {
            if (party.hostProfileId == profile.id) api.endWatchParty(baseUrl, token, party.id)
            else api.leaveWatchParty(baseUrl, token, party.id, profile.id)
            active = null
            inviteUrl = null
            refresh()
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.People, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Watch together", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(active?.media?.title ?: media?.title ?: "Start or join a party", color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                    IconButton(onClick = onDismiss) { Text("×", style = MaterialTheme.typography.headlineSmall) }
                }

                if (active != null) {
                    ActivePartyContent(active!!, inviteUrl, copied, loading, profile, onCopy = {
                        inviteUrl?.let { clipboard.setText(AnnotatedString(it)); copied = true }
                    }, onInvite = {
                        run {
                            val invite = api.createWatchPartyInvite(baseUrl, token, active!!.id)
                            inviteUrl = invite.url
                        }
                    }, onLeave = ::leave)
                } else {
                    parties.filter { it.status == "active" }.forEach { party ->
                        Card(onClick = { join(party) }, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.People, null, tint = MaterialTheme.colorScheme.primary)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) { Text(party.media.title, fontWeight = FontWeight.SemiBold); Text("${party.memberCount} participant${if (party.memberCount == 1) "" else "s"} · ${if (party.mode == "private") "Household only" else "Household + invited guests"}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
                                Text("Join", color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                    if (media != null) {
                        Text("Start a party", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(selected = mode == "private", onClick = { mode = "private" }, label = { Text("Private") })
                            FilterChip(selected = mode == "shared", onClick = { mode = "shared" }, label = { Text("Invite someone") })
                        }
                        if (mode == "shared") Text("Household members can join from Active parties. Use an invite for people outside your account.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        Button(onClick = ::startParty, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
                            if (loading) CircularProgressIndicator(Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.People, null)
                            Spacer(Modifier.width(8.dp)); Text(if (mode == "private") "Start private party" else "Start shared party")
                        }
                    }
                    Text("Join with an invite", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    OutlinedTextField(inviteInput, { inviteInput = it }, label = { Text("Invite link or token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedButton(onClick = ::accept, enabled = !loading && inviteInput.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.Link, null); Spacer(Modifier.width(8.dp)); Text("Join party") }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@Composable
private fun ActivePartyContent(
    party: WatchPartySummary,
    inviteUrl: String?,
    copied: Boolean,
    loading: Boolean,
    profile: ProfileSummary,
    onCopy: () -> Unit,
    onInvite: () -> Unit,
    onLeave: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Party active", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
        Text(party.media.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        party.members.forEach { member ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (member.profileId == profile.id) "You" else if (member.role == "host") "Host" else "Guest")
                Text(if (member.role == "host") "Controls playback" else "Following host", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (party.hostProfileId == profile.id && party.mode == "shared") {
            Text("Household members can join from Active parties. Use an invite for people outside your account.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            if (inviteUrl != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(inviteUrl, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    IconButton(onClick = onCopy) { Icon(Icons.Rounded.ContentCopy, if (copied) "Copied" else "Copy invite") }
                }
            } else {
                OutlinedButton(onClick = onInvite, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.Link, null); Spacer(Modifier.width(8.dp)); Text("Create invite") }
            }
        }
        OutlinedButton(onClick = onLeave, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Icon(if (party.hostProfileId == profile.id) Icons.Rounded.StopCircle else Icons.Rounded.Logout, null); Spacer(Modifier.width(8.dp)); Text(if (party.hostProfileId == profile.id) "End party" else "Leave party") }
    }
}
