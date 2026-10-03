package media.conduit.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import media.conduit.mobile.account.*

@Composable
internal fun WatchPartySheet(controller: WatchPartySessionController, api: ConduitApi, token: String) {
    if (!controller.sheetOpen) return
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var parties by remember { mutableStateOf<List<WatchPartySummary>>(emptyList()) }
    var input by remember(controller.inviteLink) { mutableStateOf(controller.inviteLink) }
    var invite by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var shared by remember { mutableStateOf(false) }
    LaunchedEffect(controller.profileId) {
        runCatching { api.listWatchParties(controller.baseUrl, token, controller.profileId) }
            .onSuccess { parties = it }.onFailure { error = "Watch parties are unavailable on this server" }
    }
    fun run(action: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try { action() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "Party request failed" }
            finally { busy = false }
        }
    }
    Dialog(onDismissRequest = { controller.sheetOpen = false }) {
        Surface(color = Color.Black, contentColor = Color.White) {
            Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Watch together", style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = { controller.sheetOpen = false }) { Text("Close") }
                }
                val active = controller.party
                if (active != null) {
                    Text(active.media?.title ?: "Waiting for host to choose media")
                    Text(controller.connection)
                    active.members.forEach { member ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(if (member.profileId == controller.profileId) "You" else if (member.role == "host") "Host" else "Guest")
                            Text(if (member.role == "host") "Controls playback" else "Following host")
                        }
                    }
                    if (active.isHost && active.mode == "shared") {
                        TextButton(enabled = !busy, onClick = {
                            run { invite = api.createWatchPartyInvite(controller.baseUrl, token, active.id, controller.profileId).url }
                        }) { Text("Create invite") }
                        invite?.let { value -> TextButton(onClick = { clipboard.setText(AnnotatedString(value)) }) { Text("Copy invite") } }
                    }
                    TextButton(enabled = !busy, onClick = { run { controller.leave(); controller.sheetOpen = false } }) { Text(if (active.isHost) "End party" else "Leave party") }
                } else {
                    parties.filter { it.status == "active" }.forEach { party ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(party.media?.title ?: "Waiting for media", modifier = Modifier.weight(1f))
                            TextButton(enabled = !busy, onClick = { run { controller.join(api.joinWatchParty(controller.baseUrl, token, party.id, controller.profileId)) } }) { Text("Join") }
                        }
                    }
                    Row {
                        TextButton(onClick = { shared = false }) { Text(if (!shared) "✓ Household" else "Household") }
                        TextButton(onClick = { shared = true }) { Text(if (shared) "✓ Invite guests" else "Invite guests") }
                    }
                    TextButton(enabled = !busy, onClick = {
                        run {
                            val response = api.createWatchParty(controller.baseUrl, token, controller.profileId, if (shared) "shared" else "private")
                            invite = response.invite?.url
                            controller.join(response)
                        }
                    }) { Text("Start party") }
                    OutlinedTextField(input, { input = it }, label = { Text("Invite link or token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    TextButton(enabled = !busy && input.isNotBlank(), onClick = {
                        run {
                            val value = watchPartyInviteToken(input, controller.baseUrl)
                            controller.join(api.acceptWatchPartyInvite(controller.baseUrl, token, value, controller.profileId))
                        }
                    }) { Text("Join party") }
                }
                if (busy) Text("Working…")
                (error ?: controller.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}
