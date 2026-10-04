package media.conduit.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.rememberProfileFiles

private enum class TransferTask { Choose, Export, Import }
private data class ReviewedImport(val name: String, val data: JsonObject, val preview: ProfileImportPreview)

/** One archive and target profile stay bound together from preview through confirmation. */
@Composable
internal fun ProfileTransferScreen(
    profile: ProfileSummary,
    baseUrl: String,
    token: String,
    api: ConduitApi,
    onBack: () -> Unit,
    onImported: () -> Unit,
    modifier: Modifier = Modifier,
    webHandoff: @Composable (() -> Unit)? = null,
) = key(baseUrl, token, profile.id) {
    val files = rememberProfileFiles()
    val scope = rememberCoroutineScope()
    val backFocus = remember { FocusRequester() }
    var task by remember { mutableStateOf(TransferTask.Choose) }
    var reviewed by remember { mutableStateOf<ReviewedImport?>(null) }
    var mode by remember { mutableStateOf(ProfileImportMode.Merge) }
    var includeSecrets by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmReplace by remember { mutableStateOf(false) }
    fun runOperation(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        message = null
        scope.launch {
            try { block() }
            catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) { error = cause.message ?: "Profile transfer failed" }
            finally { busy = false }
        }
    }
    fun chooseFile() = runOperation {
        // A failed or cancelled selection cannot leave an older archive ready to import.
        reviewed = null
        mode = ProfileImportMode.Merge
        val file = files.pick() ?: return@runOperation
        val data = withContext(Dispatchers.Default) { parseProfileArchive(file.bytes) }
        val preview = api.previewProfileImport(baseUrl, token, profile.id, data)
        reviewed = ReviewedImport(file.name, data, preview)
    }
    fun applyImport() {
        val archive = reviewed ?: return
        val selectedMode = mode
        runOperation {
            api.importProfile(baseUrl, token, profile.id, archive.data, selectedMode)
            backFocus.requestFocus()
            reviewed = null
            task = TransferTask.Choose
            message = "Profile imported"
            onImported()
        }
    }
    val goBack: () -> Unit = {
        if (!busy) {
            if (task == TransferTask.Choose) onBack()
            else { task = TransferTask.Choose; reviewed = null; error = null; message = null }
        }
    }
    PlatformBackHandler(enabled = task != TransferTask.Choose || busy, onBack = goBack)
    val archive = reviewed
    val hasAction = (task == TransferTask.Export && files.canExport) ||
        (task == TransferTask.Import && archive != null)
    Column(
        modifier.fillMaxSize().background(Color.Black).focusGroup().statusBarsPadding()
            .padding(bottom = if (webHandoff == null) 112.dp else 16.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = goBack, enabled = !busy, modifier = Modifier.focusRequester(backFocus)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack,
                    if (task == TransferTask.Choose) "Back to settings" else "Back to profile data", tint = Color.White)
            }
            Text(when (task) {
                TransferTask.Choose -> "Profile data"
                TransferTask.Export -> "Export profile"
                TransferTask.Import -> if (archive == null) "Import profile" else "Review import"
            }, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        }
        TransferDivider()
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            when (task) {
                TransferTask.Choose -> {
                    TransferValueRow("Profile", profile.name)
                    TransferTaskRow("Export profile", "Save a JSON backup", enabled = !busy) {
                        backFocus.requestFocus()
                        task = TransferTask.Export
                        message = null
                    }
                    TransferTaskRow("Import profile", "Choose a file and review changes", enabled = !busy) {
                        backFocus.requestFocus()
                        task = TransferTask.Import
                        message = null
                    }
                }
                TransferTask.Export -> {
                    Text(profile.name, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                    TransferDetail("Profile, library, history and add-ons.", Modifier.padding(top = 8.dp, bottom = 24.dp))
                    TransferDivider()
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 64.dp)
                            .toggleable(includeSecrets, enabled = !busy, role = Role.Checkbox) { includeSecrets = it },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = includeSecrets, onCheckedChange = null, enabled = !busy)
                        Column(Modifier.weight(1f).padding(start = 8.dp, end = 4.dp)) {
                            Text("Include add-on URLs", color = Color.White, fontSize = 15.sp)
                            TransferDetail("URLs may contain credentials.")
                        }
                    }
                    if (!files.canExport && webHandoff == null) TransferDetail("Save this export using a phone or browser.")
                }
                TransferTask.Import -> {
                    if (archive != null) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("BACKUP", color = TransferMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                            TextButton(onClick = ::chooseFile, enabled = !busy) { Text("Change file", fontSize = 14.sp) }
                        }
                        Text(archive.preview.profile.name, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                        TransferDetail(archive.name, Modifier.padding(top = 4.dp))
                        Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TransferCount(archive.preview.counts.library.toString(), "Library items", Modifier.weight(1f))
                            TransferCount(archive.preview.counts.progress.toString(), "History entries", Modifier.weight(1f))
                            TransferCount("${archive.preview.importableAddons} / ${archive.preview.counts.addons}", "Add-ons", Modifier.weight(1f))
                        }
                        TransferDivider()
                        archive.preview.warnings.forEach {
                            Text(it, color = MaterialTheme.colorScheme.primary, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                        }
                        Spacer(Modifier.height(24.dp))
                        TransferDivider()
                        TransferValueRow("Import into", profile.name)
                        Row(Modifier.fillMaxWidth().selectableGroup()) {
                            ProfileImportMode.entries.forEach { option ->
                                val selected = mode == option
                                Column(
                                    Modifier.weight(1f).selectable(selected, enabled = !busy, role = Role.Tab) { mode = option },
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp), contentAlignment = Alignment.Center) {
                                        Text(if (option == ProfileImportMode.Merge) "Merge" else "Replace", fontSize = 15.sp,
                                            color = if (selected) MaterialTheme.colorScheme.primary else Color.White)
                                    }
                                    HorizontalDivider(thickness = 2.dp, color = if (selected) MaterialTheme.colorScheme.primary else TransferRule)
                                }
                            }
                        }
                        TransferDetail(
                            if (mode == ProfileImportMode.Merge) "Keep existing entries and update matches."
                            else "Replace this profile's library, history and add-ons. Confirmation required.",
                            Modifier.padding(top = 12.dp),
                        )
                        TransferDetail("Profile name and kids setting also update.", Modifier.padding(top = 12.dp))
                    } else if (files.canImport) {
                        TransferValueRow("Import into", profile.name)
                        TransferTaskRow("Choose file", "JSON backup up to 10 MiB", enabled = !busy, onClick = ::chooseFile)
                        TransferDetail("Review the file before importing.", Modifier.padding(top = 12.dp))
                    } else if (webHandoff == null) TransferDetail("Import using a phone or browser.")
                }
            }
            if (webHandoff != null && task != TransferTask.Choose) {
                Spacer(Modifier.height(20.dp))
                webHandoff()
            }
            if (!hasAction) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp)) }
                message?.let { Text(it, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp)) }
                if (busy) TransferDetail("Working…", Modifier.padding(top = 12.dp))
            }
        }
        if (hasAction) {
            TransferDivider()
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 14.sp, modifier = Modifier.padding(bottom = 10.dp)) }
                message?.let { Text(it, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(bottom = 10.dp)) }
                Button(
                    shape = RoundedCornerShape(3.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    enabled = !busy,
                    onClick = {
                        if (task == TransferTask.Export) runOperation {
                            val data = api.exportProfile(baseUrl, token, profile.id, includeSecrets)
                            if (files.save("conduit-${profile.id}.json", data.toString())) message = "Profile exported"
                        } else if (mode == ProfileImportMode.Replace) confirmReplace = true else applyImport()
                    },
                ) {
                    Text(if (busy) "Working…" else if (task == TransferTask.Export) "Save JSON file" else "Import into ${profile.name}", fontSize = 15.sp)
                }
            }
        }
    }
    if (confirmReplace) AlertDialog(
        onDismissRequest = { confirmReplace = false },
        title = { Text("Replace ${profile.name}?") },
        text = { Text("The existing library, watch history, and add-ons will be removed and replaced with this file.") },
        confirmButton = { TextButton(onClick = { confirmReplace = false; applyImport() }) { Text("Replace and import", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmReplace = false }) { Text("Cancel") } },
    )
}

private val TransferMuted = Color(0xFFAAAAAA)
private val TransferRule = Color(0xFF292929)

@Composable
private fun TransferDivider() = HorizontalDivider(color = TransferRule)

@Composable
private fun TransferDetail(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, color = TransferMuted, fontSize = 13.sp, lineHeight = 19.sp)
}

@Composable
private fun TransferValueRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(label, color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(value, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}

@Composable
private fun TransferTaskRow(title: String, detail: String, enabled: Boolean, onClick: () -> Unit) {
    TransferDivider()
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            TransferDetail(detail, Modifier.padding(top = 2.dp))
        }
        Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = Color.White)
    }
}

@Composable
private fun TransferCount(value: String, label: String, modifier: Modifier) {
    Column(modifier) {
        Text(value, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Medium)
        TransferDetail(label)
    }
}
