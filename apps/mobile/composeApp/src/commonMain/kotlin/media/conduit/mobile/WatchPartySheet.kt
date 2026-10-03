package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import media.conduit.mobile.account.*

private val partyAmber = Color(0xFFFBBF24)

@Composable
internal fun BoxScope.WatchPartySheet(controller: WatchPartySessionController, api: ConduitApi, token: String, inPlayer: Boolean = false) {
    if (!controller.sheetOpen) return
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var parties by remember { mutableStateOf<List<WatchPartySummary>>(emptyList()) }
    var input by remember(controller.inviteLink) { mutableStateOf(controller.inviteLink) }
    var invite by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var shared by remember { mutableStateOf(false) }
    LaunchedEffect(controller.profileId) {
        runCatching { api.listWatchParties(controller.baseUrl, token, controller.profileId) }
            .onSuccess { parties = it }.onFailure { error = "Watch parties are unavailable on this server" }
    }
    LaunchedEffect(copied) {
        if (copied) { kotlinx.coroutines.delay(1600); copied = false }
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
    PlatformBackHandler(enabled = true, onBack = { controller.sheetOpen = false })
    Box(Modifier.matchParentSize().background(Color.Black.copy(if (inPlayer) .25f else .6f))) {
        Box(Modifier.matchParentSize().clickable(onClick = { controller.sheetOpen = false }))
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val sidebar = inPlayer && maxWidth > maxHeight
            val panelWidth = (maxWidth * .9f).coerceAtMost(384.dp)
            val modalHeight = (controller.party?.let { (320 + it.members.size * 48).dp } ?: 520.dp)
                .coerceAtMost((maxHeight - 48.dp).coerceAtLeast(240.dp))
            Surface(
                modifier = if (sidebar) Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(panelWidth) else Modifier.align(Alignment.Center).width(panelWidth).height(modalHeight),
                color = Color.Black,
                contentColor = Color.White,
                shape = if (sidebar) RoundedCornerShape(topStart = 28.dp, bottomStart = 28.dp) else RoundedCornerShape(20.dp),
                shadowElevation = 20.dp,
            ) {
                Column(Modifier.fillMaxSize().then(if (sidebar) Modifier.statusBarsPadding().navigationBarsPadding() else Modifier).padding(horizontal = 24.dp, vertical = 12.dp)) {
                    Row(Modifier.fillMaxWidth().padding(bottom = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.People, null, tint = partyAmber, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.width(12.dp))
                        Text("Watch together", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        IconButton(onClick = { controller.sheetOpen = false }) { Icon(Icons.Rounded.Close, "Close watch party", tint = Color.White.copy(.65f)) }
                    }
                    val active = controller.party
                    if (active != null) {
                        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                            Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Box(Modifier.width(44.dp).height(64.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF18181B)), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Rounded.Movie, null, tint = Color.White.copy(.4f))
                                    active.media?.poster?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(active.media?.title ?: "Waiting for media", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Box(Modifier.size(6.dp).clip(RoundedCornerShape(3.dp)).background(if (controller.connection == "Connected") partyAmber else Color.Gray))
                                        Text(controller.connection, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(.6f))
                                    }
                                }
                            }
                            HorizontalDivider(color = Color.White.copy(.1f))
                            Text("Watching · ${active.members.size}", Modifier.padding(top = 18.dp, bottom = 8.dp), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(.8f))
                            active.members.forEachIndexed { index, member ->
                                val self = member.profileId == controller.profileId
                                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(if (self) partyAmber.copy(.15f) else Color(0xFF18181B)), contentAlignment = Alignment.Center) {
                                        Text(if (self) "Y" else if (member.role == "host") "H" else "G", color = if (self) partyAmber else Color.White.copy(.8f), style = MaterialTheme.typography.labelMedium)
                                    }
                                    Text(if (self) "You" else if (member.role == "host") "Host" else "Guest ${active.members.take(index + 1).count { it.role != "host" }}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                                    if (member.ready && member.role != "host") Icon(Icons.Rounded.Check, null, tint = partyAmber, modifier = Modifier.size(14.dp))
                                    Text(if (member.role == "host") "Host" else if (member.ready) "Ready" else "Following host", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(.6f))
                                }
                            }
                        }
                        HorizontalDivider(color = Color.White.copy(.1f))
                        Column(Modifier.fillMaxWidth().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (active.isHost && active.mode == "shared") {
                                Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = partyAmber, contentColor = Color.Black), onClick = {
                                    if (invite != null) { clipboard.setText(AnnotatedString(invite!!)); copied = true }
                                    else run { invite = api.createWatchPartyInvite(controller.baseUrl, token, active.id, controller.profileId).url }
                                }) {
                                    Icon(if (copied) Icons.Rounded.Check else Icons.Rounded.Link, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(if (invite == null) "Create invite" else if (copied) "Copied" else "Copy invite")
                                }
                            }
                            TextButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFFCA5A5)), onClick = { run { controller.leave(); controller.sheetOpen = false } }) { Text(if (active.isHost) "End party" else "Leave party") }
                        }
                    } else {
                        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                            listOf(false, true).forEach { option ->
                                val selected = shared == option
                                Surface(onClick = { shared = option }, color = if (selected) partyAmber else Color.Transparent, contentColor = if (selected) Color.Black else Color.White, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                                    Row(Modifier.padding(12.dp).heightIn(min = 42.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Icon(if (option) Icons.Rounded.Link else Icons.Rounded.Home, null, Modifier.size(18.dp))
                                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Text(if (option) "Invite guests" else "Household", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                            Text(if (option) "Share a one-use link" else "Profiles in your household", style = MaterialTheme.typography.bodySmall, color = if (selected) Color.Black.copy(.7f) else Color.White.copy(.5f))
                                        }
                                        if (selected) Icon(Icons.Rounded.Check, null, Modifier.size(16.dp))
                                    }
                                }
                            }
                            Button(enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = partyAmber, contentColor = Color.Black), onClick = {
                                run {
                                    val response = api.createWatchParty(controller.baseUrl, token, controller.profileId, if (shared) "shared" else "private")
                                    invite = response.invite?.url
                                    controller.join(response)
                                }
                            }) { Text("Start party", fontWeight = FontWeight.SemiBold) }
                            parties.filter { it.status == "active" }.forEach { party ->
                                HorizontalDivider(Modifier.padding(top = 18.dp), color = Color.White.copy(.1f))
                                Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(party.media?.title ?: "Waiting for media", style = MaterialTheme.typography.bodyMedium)
                                        Text("${party.memberCount} watching", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(.6f))
                                    }
                                    OutlinedButton(enabled = !busy, shape = RoundedCornerShape(8.dp), onClick = { run { controller.join(api.joinWatchParty(controller.baseUrl, token, party.id, controller.profileId)) } }) { Text("Join", color = Color.White) }
                                }
                            }
                        }
                        HorizontalDivider(color = Color.White.copy(.1f))
                        Text("Join a party", Modifier.padding(top = 16.dp, bottom = 12.dp), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(.8f))
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(input, { input = it }, placeholder = { Text("Paste invite link", style = MaterialTheme.typography.bodySmall) }, singleLine = true, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = partyAmber, focusedTextColor = Color.White, unfocusedTextColor = Color.White))
                            TextButton(enabled = !busy && input.isNotBlank(), onClick = {
                                run { controller.join(api.acceptWatchPartyInvite(controller.baseUrl, token, watchPartyInviteToken(input, controller.baseUrl), controller.profileId)) }
                            }) { Text("Join", color = if (input.isNotBlank()) Color.White else Color.Gray) }
                        }
                    }
                    if (busy) Text("Working…", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodySmall, color = Color.White.copy(.6f))
                    (error ?: controller.error)?.let { Text(it, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}
