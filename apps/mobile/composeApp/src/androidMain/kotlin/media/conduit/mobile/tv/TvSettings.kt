package media.conduit.mobile.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import media.conduit.mobile.AndroidPlaybackEngine
import media.conduit.mobile.PlatformBackHandler
import media.conduit.mobile.SubtitleStyleControls
import media.conduit.mobile.TvShellModel
import media.conduit.mobile.account.AuthenticationMethods
import media.conduit.mobile.account.DiagnosticLevel
import media.conduit.mobile.account.DiagnosticLogEntry
import media.conduit.mobile.account.DiagnosticLogStore
import media.conduit.mobile.account.InstalledAddonSummary
import media.conduit.mobile.account.ProfileSummary
import media.conduit.mobile.foundation.DevicePreferences
import media.conduit.mobile.foundation.ResumeBehavior
import media.conduit.mobile.foundation.AppAction
import media.conduit.mobile.languagePreferenceLabel
import media.conduit.mobile.languagePreferenceOptions
import media.conduit.mobile.licenseNotices
import media.conduit.mobile.normalizeManifestUrl
import media.conduit.mobile.profileColor

private enum class TvSettingsSection(val label: String) {
    Profiles("Profiles"),
    Addons("Add-ons"),
    Data("Profile data"),
    Playback("Playback"),
    Appearance("Appearance"),
    Account("Account"),
    Advanced("Advanced"),
    About("About"),
}

/**
 * Settings on TV: a section list on the left that switches the pane on focus,
 * and that section's rows on the right.
 */
@Composable
internal fun TvSettings(model: TvShellModel, memory: TvFocusMemory, active: Boolean) {
    var section by remember { mutableStateOf(TvSettingsSection.Profiles) }
    var editing by remember { mutableStateOf<TvProfileDraft?>(null) }
    var logsOpen by remember { mutableStateOf(false) }
    PlatformBackHandler(enabled = active && (editing != null || logsOpen), onBack = { editing = null; logsOpen = false })
    // Closing the editor or the log viewer removes the focused control; hand focus back to the section list.
    val subpageOpen = editing != null || logsOpen
    var subpageUsed by remember { mutableStateOf(false) }
    LaunchedEffect(subpageOpen) {
        if (subpageOpen) subpageUsed = true
        else if (subpageUsed) {
            androidx.compose.runtime.withFrameNanos { }
            memory.restore()
        }
    }

    TvPage("Settings") {
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Column(Modifier.width(170.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                TvSettingsSection.entries.forEach { entry ->
                    TvFocusable(
                        onClick = { section = entry },
                        onFocused = {
                            if (section != entry) {
                                section = entry
                                editing = null
                                logsOpen = false
                            }
                        },
                        container = { focused ->
                            when {
                                focused -> TvColors.ControlFocused
                                entry == section -> TvColors.Amber.copy(alpha = .15f)
                                else -> Color.Transparent
                            }
                        },
                        modifier = Modifier.fillMaxWidth().tvRememberFocus(memory, "section:${entry.name}"),
                    ) {
                        Text(
                            entry.label,
                            color = if (entry == section) TvColors.AmberSoft else Color.White,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                        )
                    }
                }
            }
            if (section == TvSettingsSection.Data) {
                TvProfileData(model, onBack = { section = TvSettingsSection.Profiles }, Modifier.weight(1f).fillMaxHeight())
            } else LazyColumn(
                Modifier.weight(1f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                contentPadding = PaddingValues(bottom = 60.dp),
            ) {
                when (section) {
                    TvSettingsSection.Profiles -> {
                        val draft = editing
                        if (draft != null) profileEditor(model, draft, onDone = { editing = null })
                        else profileList(model, onEdit = { editing = it })
                    }
                    TvSettingsSection.Data -> Unit
                    TvSettingsSection.Addons -> item { TvAddonManager(model) }
                    TvSettingsSection.Playback -> playbackSettings(model.preferences, model.onPreferencesChanged)
                    TvSettingsSection.Appearance -> appearanceSettings(model)
                    TvSettingsSection.Account -> item { TvAccountSettings(model) }
                    TvSettingsSection.Advanced -> advancedSettings(model, logsOpen, onLogs = { logsOpen = it })
                    TvSettingsSection.About -> aboutSettings(model)
                }
            }
        }
    }
}

@Composable
private fun TvProfileData(model: TvShellModel, onBack: () -> Unit, modifier: Modifier) {
    model.activeProfile?.let { profile ->
        media.conduit.mobile.ProfileTransferScreen(
            profile, requireNotNull(model.state.endpoint).baseUrl, model.account.session.token, model.api,
            onBack = onBack,
            onImported = { model.onProfilesChanged(profile.id); model.onRefresh() },
            modifier = modifier,
            webHandoff = {
                Text("Continue on phone or browser", color = Color.White)
                var address by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(model.state.endpoint?.baseUrl) {
                    try {
                        address = model.api.profileTransferWebUrl(requireNotNull(model.state.endpoint).baseUrl)
                    } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
                    catch (_: Exception) { address = null }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    address?.let { url -> TvQrCode(url, Modifier.size(120.dp)) }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        address?.let { Text(it, color = Color.White) }
                        Text("Sign in, select ${profile.name}, then open Settings > Your data on the web, or Profile data on mobile.", color = Color.White)
                        if (address == null) Text("Use the web or mobile app connected to this server.", color = Color.White)
                    }
                }
            },
        )
    }
}

@Composable
private fun TvSettingRow(
    title: String,
    detail: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    value: String? = null,
    destructive: Boolean = false,
    enabled: Boolean = true,
) {
    TvFocusable(onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    color = when {
                        !enabled -> TvColors.Dim
                        destructive -> MaterialTheme.colorScheme.error
                        else -> Color.White
                    },
                    fontWeight = FontWeight.Medium,
                )
                detail?.let { Text(it, color = TvColors.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }
            value?.let { Text(it, color = TvColors.AmberSoft, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp)) }
        }
    }
}

@Composable
private fun TvSettingToggle(title: String, detail: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    TvSettingRow(title, detail, onClick = { onChange(!checked) }, value = if (checked) "On" else "Off")
}

/** A setting whose value is chosen from a short list in a dialog. */
@Composable
private fun TvSettingChoice(
    title: String,
    value: String,
    options: List<Pair<String, String>>,
    selectedKey: String,
    onSelect: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    TvSettingRow(title, null, onClick = { open = true }, value = value)
    if (open) {
        TvOptionDialog(title, options, selectedKey, onSelect = { open = false; onSelect(it) }, onDismiss = { open = false })
    }
}

private fun LazyListScope.sectionLabel(text: String) {
    item { TvSectionLabel(text, Modifier.padding(start = 14.dp, top = 12.dp, bottom = 4.dp)) }
}

@Composable
internal fun TvConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val cancel = remember { FocusRequester() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        LaunchedEffect(Unit) { cancel.requestFocusWhenReady() }
        Column(
            Modifier.width(420.dp).background(Color(0xFF18181B), RoundedCornerShape(16.dp))
                .border(1.dp, TvColors.Hairline, RoundedCornerShape(16.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(message, color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton("Cancel", onClick = onDismiss, modifier = Modifier.focusRequester(cancel))
                TvButton(confirmLabel, onClick = onConfirm, primary = true)
            }
        }
    }
}

// --- Profiles ---------------------------------------------------------------

/** The profile being created (null [id]) or edited. */
internal data class TvProfileDraft(val id: String?, val source: ProfileSummary?)

private val profileColors = listOf("#FFC107", "#FF8F00", "#E53935", "#8E24AA", "#3949AB", "#039BE5", "#00897B", "#43A047")

private fun LazyListScope.profileList(model: TvShellModel, onEdit: (TvProfileDraft) -> Unit) {
    sectionLabel("Profiles")
    items(model.profiles, key = ProfileSummary::id) { profile ->
        val activeProfile = profile.id == model.activeProfile?.id
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TvFocusable(onClick = { model.dispatch(AppAction.SelectProfile(profile.id)) }, modifier = Modifier.weight(1f)) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TvAvatar(profile, 36.dp)
                    Column(Modifier.weight(1f)) {
                        Text(profile.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(
                            listOfNotNull(
                                if (profile.isKids) "Kids" else null,
                                if (profile.usesPrimaryAddons) "Primary add-ons" else null,
                            ).joinToString(" · ").ifBlank { "Profile" },
                            color = TvColors.Muted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (activeProfile) Text("Active", color = TvColors.AmberSoft, fontWeight = FontWeight.SemiBold)
                }
            }
            TvIconButton(Icons.Rounded.Edit, "Edit ${profile.name}", onClick = { onEdit(TvProfileDraft(profile.id, profile)) })
        }
    }
    item { TvButton("Add profile", onClick = { onEdit(TvProfileDraft(null, null)) }, modifier = Modifier.padding(start = 12.dp, top = 8.dp)) }
}

private fun LazyListScope.profileEditor(model: TvShellModel, draft: TvProfileDraft, onDone: () -> Unit) {
    item(key = "editor:${draft.id}") {
        val profile = draft.source
        val scope = rememberCoroutineScope()
        var name by remember { mutableStateOf(profile?.name.orEmpty()) }
        var kids by remember { mutableStateOf(profile?.isKids ?: false) }
        var color by remember { mutableStateOf(profile?.avatarColor ?: profileColors.first()) }
        var url by remember { mutableStateOf(profile?.avatarUrl.orEmpty()) }
        var saving by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        val account = model.account
        val primary = account.bootstrap.households
            .firstOrNull { household -> household.profiles.any { it.id == (profile?.id ?: model.activeProfile?.id) } }
            ?.profiles?.firstOrNull()
        val canUsePrimary = profile == null || profile.id != primary?.id
        var usesPrimaryAddons by remember { mutableStateOf(profile?.usesPrimaryAddons ?: false) }
        val first = remember { FocusRequester() }
        val saveFocus = remember { FocusRequester() }
        LaunchedEffect(Unit) { first.requestFocusWhenReady() }

        Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TvSectionLabel(if (profile == null) "Add profile" else "Edit profile", Modifier.padding(top = 12.dp))
            TvTextField(name, { name = it }, "Profile name", Modifier.width(360.dp).focusRequester(first))
            TvSettingToggle("Kids profile", "Use a child-friendly profile", kids) { kids = it }
            if (canUsePrimary) {
                TvSettingToggle("Use primary add-ons", "Share ${primary?.name ?: "the primary profile"}'s live add-on setup", usesPrimaryAddons) { usesPrimaryAddons = it }
            }
            TvSectionLabel("Avatar color", Modifier.padding(top = 6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // Keeps a custom color chosen on another device selectable here.
                (profileColors + color).distinctBy { it.uppercase() }.forEach { option ->
                    TvFocusable(onClick = { color = option }, shape = CircleShape, container = { profileColor(option) }, modifier = Modifier.size(34.dp)) {
                        if (color.equals(option, ignoreCase = true)) {
                            Box(Modifier.align(Alignment.Center).size(12.dp).background(Color.White, CircleShape))
                        }
                    }
                }
            }
            TvTextField(
                url, { url = it }, "Avatar image link (optional)",
                // Down from this wide field would otherwise land on Cancel, which sits nearer its center.
                Modifier.width(360.dp).focusProperties { down = saveFocus },
                placeholder = "https://example.com/avatar.png", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 4.dp)) {
                TvButton(
                    if (saving) "Saving…" else if (profile == null) "Create profile" else "Save changes",
                    enabled = !saving,
                    primary = true,
                    modifier = Modifier.focusRequester(saveFocus),
                    onClick = {
                        scope.launch {
                            saving = true
                            error = null
                            runCatching {
                                val endpoint = requireNotNull(model.state.endpoint)
                                val cleanUrl = url.trim().ifBlank { null }
                                require(cleanUrl == null || cleanUrl.startsWith("https://") || cleanUrl.startsWith("http://")) {
                                    "Avatar link must begin with http:// or https://"
                                }
                                require(name.isNotBlank()) { "Enter a profile name" }
                                val cleanColor = color.takeIf { cleanUrl == null }
                                if (profile == null) {
                                    model.api.createProfile(
                                        endpoint.baseUrl, account.session.token, account.bootstrap.households.first().id,
                                        name, kids, usesPrimaryAddons, cleanColor, cleanUrl,
                                    )
                                } else {
                                    model.api.updateProfile(
                                        endpoint.baseUrl, account.session.token, profile.id,
                                        name, kids, usesPrimaryAddons, cleanColor, cleanUrl,
                                    )
                                }
                            }.onSuccess { saved ->
                                model.onProfilesChanged(saved.id)
                                onDone()
                            }.onFailure { error = it.message ?: "Unable to save profile" }
                            saving = false
                        }
                    },
                )
                TvButton("Cancel", onClick = onDone)
            }
        }
    }
}

// --- Add-ons ----------------------------------------------------------------

@Composable
private fun TvAddonManager(model: TvShellModel) {
    val scope = rememberCoroutineScope()
    val profile = model.activeProfile
    val initial = model.sync.snapshot?.addons.orEmpty()
    var addons by remember(initial) { mutableStateOf(initial) }
    var manifestUrl by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var removeTarget by remember { mutableStateOf<InstalledAddonSummary?>(null) }
    val linked = profile?.usesPrimaryAddons == true

    fun runMutation(onSuccess: () -> Unit = {}, block: suspend (base: String, token: String, profileId: String) -> Unit) {
        val endpoint = model.state.endpoint ?: return
        val profileId = profile?.id ?: return
        scope.launch {
            busy = true
            error = null
            runCatching {
                block(endpoint.baseUrl, model.account.session.token, profileId)
                addons = model.api.synchronizeProfile(endpoint.baseUrl, model.account.session.token, profileId).addons
                model.onRefresh()
                onSuccess()
            }.onFailure { error = it.message ?: "Unable to update add-ons" }
            busy = false
        }
    }
    val install = {
        val url = normalizeManifestUrl(manifestUrl)
        if (!busy && url.isNotBlank()) {
            runMutation(onSuccess = { manifestUrl = "" }) { base, token, id -> model.api.installAddon(base, token, id, url) }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (linked) {
            Text("This profile uses the primary profile's add-ons. Manage them from that profile.", color = TvColors.AmberSoft, modifier = Modifier.padding(14.dp))
        } else {
            TvSectionLabel("Install", Modifier.padding(start = 14.dp, top = 12.dp))
            Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvTextField(
                    manifestUrl, { manifestUrl = it }, "Manifest link", Modifier.weight(1f),
                    placeholder = "https://…/manifest.json", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done, onImeAction = install,
                )
                TvButton(if (busy) "Working…" else "Install", onClick = install, primary = true, enabled = !busy && normalizeManifestUrl(manifestUrl).isNotBlank())
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 14.dp)) }
        TvSectionLabel("Installed · ${addons.count { it.enabled }} of ${addons.size} active", Modifier.padding(start = 14.dp, top = 12.dp))
        if (addons.isEmpty()) Text("No add-ons installed.", color = TvColors.Muted, modifier = Modifier.padding(14.dp))
        addons.forEachIndexed { index, addon ->
            val name = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
            val logo = addon.manifest["logo"]?.jsonPrimitive?.contentOrNull
            val version = addon.manifest["version"]?.jsonPrimitive?.contentOrNull
            val catalogs = addon.manifest["catalogs"]?.let { runCatching { it.jsonArray.size }.getOrDefault(0) } ?: 0
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TvFocusable(
                    onClick = { runMutation { base, token, id -> model.api.setAddonEnabled(base, token, id, addon.id, !addon.enabled) } },
                    enabled = !linked && !busy,
                    modifier = Modifier.weight(1f),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(36.dp).background(Color.White.copy(alpha = .05f), RoundedCornerShape(8.dp))) {
                            if (!logo.isNullOrBlank()) AsyncImage(logo, null, Modifier.matchParentSize(), contentScale = ContentScale.Fit)
                            else Icon(Icons.Rounded.Extension, null, tint = TvColors.Amber, modifier = Modifier.align(Alignment.Center).size(20.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(name, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOfNotNull(version?.let { "v$it" }, "$catalogs catalogs").joinToString(" · "),
                                color = TvColors.Muted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text(if (addon.enabled) "On" else "Off", color = if (addon.enabled) TvColors.AmberSoft else TvColors.Dim, fontWeight = FontWeight.SemiBold)
                    }
                }
                if (!linked) {
                    if (index > 0) TvIconButton(Icons.Rounded.ArrowUpward, "Move $name up", size = 38.dp, onClick = {
                        if (!busy) runMutation { base, token, id -> model.api.moveAddon(base, token, id, addon.id, index - 1) }
                    })
                    if (index < addons.lastIndex) TvIconButton(Icons.Rounded.ArrowDownward, "Move $name down", size = 38.dp, onClick = {
                        if (!busy) runMutation { base, token, id -> model.api.moveAddon(base, token, id, addon.id, index + 1) }
                    })
                    TvIconButton(Icons.Rounded.Refresh, "Refresh $name", size = 38.dp, onClick = {
                        if (!busy) runMutation { base, token, id -> model.api.installAddon(base, token, id, addon.manifestUrl) }
                    })
                    TvIconButton(Icons.Rounded.DeleteOutline, "Remove $name", size = 38.dp, onClick = { removeTarget = addon })
                }
            }
        }
    }
    removeTarget?.let { target ->
        val name = target.manifest["name"]?.jsonPrimitive?.contentOrNull ?: target.manifestId
        TvConfirmDialog(
            title = "Remove add-on?",
            message = "$name will stop providing catalogs and streams for this profile.",
            confirmLabel = "Remove",
            onConfirm = {
                removeTarget = null
                runMutation { base, token, id -> model.api.removeAddon(base, token, id, target.id) }
            },
            onDismiss = { removeTarget = null },
        )
    }
}

// --- Playback and appearance --------------------------------------------------

internal fun LazyListScope.playbackSettings(preferences: DevicePreferences, update: (DevicePreferences) -> Unit) {
    sectionLabel("Player")
    item {
        TvSettingChoice(
            "Player engine",
            preferences.androidPlaybackEngine.label,
            AndroidPlaybackEngine.entries.map { it.name to "${it.label} · ${it.description}" },
            preferences.androidPlaybackEngine.name,
        ) { key -> AndroidPlaybackEngine.entries.firstOrNull { it.name == key }?.let { update(preferences.copy(androidPlaybackEngine = it)) } }
    }
    item {
        TvSettingChoice("Resume behavior", preferences.resumeBehavior.label, ResumeBehavior.entries.map { it.name to it.label }, preferences.resumeBehavior.name) { key ->
            ResumeBehavior.entries.firstOrNull { it.name == key }?.let { update(preferences.copy(resumeBehavior = it)) }
        }
    }
    item { TvSettingToggle("Auto-select saved streams", "Reuse the last selected stream when it is available", preferences.autoSelectSavedStreams) { update(preferences.copy(autoSelectSavedStreams = it)) } }
    item { TvSettingToggle("Automatically select streams", "Choose sources for Next and queued playback", preferences.autoSelectNextStreams) { update(preferences.copy(autoSelectNextStreams = it)) } }
    item { TvSettingToggle("Skip intro and credits", "Show skip buttons when timestamps are available", preferences.skipSegments) { update(preferences.copy(skipSegments = it)) } }
    item { TvSettingToggle("Automatically continue playback", "Start the next queued item or episode when playback ends", preferences.autoplayNextEpisode) { update(preferences.copy(autoplayNextEpisode = it)) } }
    sectionLabel("Playback tuning")
    item {
        val durations = ((10..120 step 10).toList() + listOfNotNull(preferences.readAheadSeconds)).distinct().sorted()
        val options = listOf("automatic" to "Automatic") + durations.map { it.toString() to "$it seconds" }
        TvSettingChoice("Network read-ahead", preferences.readAheadSeconds?.let { "$it seconds" } ?: "Automatic", options, preferences.readAheadSeconds?.toString() ?: "automatic") { key ->
            update(preferences.copy(readAheadSeconds = key.toIntOrNull()))
        }
    }
    if (preferences.androidPlaybackEngine != AndroidPlaybackEngine.Media3) {
        item {
            TvSettingToggle("Hardware decoding", "Applies to libmpv, including automatic fallback. Changes apply to the next playback.", preferences.hardwareDecoding) {
                update(preferences.copy(hardwareDecoding = it))
            }
        }
    }
    sectionLabel("Audio and subtitles")
    item {
        TvSettingChoice("Preferred audio language", languagePreferenceLabel(preferences.preferredAudioLanguage), languagePreferenceOptions, preferences.preferredAudioLanguage) {
            update(preferences.copy(preferredAudioLanguage = it))
        }
    }
    item {
        TvSettingChoice("Primary subtitle language", languagePreferenceLabel(preferences.preferredSubtitleLanguage), languagePreferenceOptions, preferences.preferredSubtitleLanguage) {
            update(preferences.copy(preferredSubtitleLanguage = it))
        }
    }
    item {
        TvSettingChoice("Secondary subtitle language", preferences.secondarySubtitleLanguage?.let(::languagePreferenceLabel) ?: "None", listOf("None" to "None") + languagePreferenceOptions, preferences.secondarySubtitleLanguage ?: "None") {
            update(preferences.copy(secondarySubtitleLanguage = it.takeUnless { language -> language == "None" }))
        }
    }
    item {
        SubtitleStyleControls(
            style = preferences.subtitleStyle,
            onChange = { update(preferences.copy(subtitleStyle = it)) },
            modifier = Modifier.width(360.dp).padding(horizontal = 14.dp, vertical = 8.dp),
            contentColor = Color.White,
        )
    }
}

private fun LazyListScope.appearanceSettings(model: TvShellModel) {
    val preferences = model.preferences
    sectionLabel("Theme")
    item { TvSettingToggle("AMOLED black", "Use pure black backgrounds", preferences.amoledBlack) { model.onPreferencesChanged(preferences.copy(amoledBlack = it)) } }
    item { TvSettingToggle("Reduce animations", "Use simpler transitions and motion", preferences.reduceAnimations) { model.onPreferencesChanged(preferences.copy(reduceAnimations = it)) } }
}

// --- Account ------------------------------------------------------------------

@Composable
private fun TvAccountSettings(model: TvShellModel) {
    val scope = rememberCoroutineScope()
    val baseUrl = model.state.endpoint?.baseUrl.orEmpty()
    val token = model.account.session.token
    var methods by remember { mutableStateOf<AuthenticationMethods?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var changingPassword by remember { mutableStateOf(false) }
    var recoveryCodes by remember { mutableStateOf<List<String>>(emptyList()) }
    var confirmSignOut by remember { mutableStateOf(false) }
    LaunchedEffect(token) {
        methods = runCatching { model.api.authenticationMethods(baseUrl, token) }.getOrElse { message = it.message; null }
    }
    val passwordEnabled = methods?.passwordEnabled == true

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TvSectionLabel("Status", Modifier.padding(start = 14.dp, top = 12.dp, bottom = 4.dp))
        Column(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) {
            Text(model.account.bootstrap.user?.email ?: "conduit account", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(baseUrl, color = TvColors.Muted, style = MaterialTheme.typography.bodySmall)
        }
        TvSectionLabel("Security", Modifier.padding(start = 14.dp, top = 12.dp, bottom = 4.dp))
        TvSettingRow(
            if (passwordEnabled) "Change password" else "Enable password",
            if (methods == null) "Loading authentication methods…" else "Use email and password to sign in",
            onClick = { changingPassword = true },
            enabled = methods != null,
        )
        if (passwordEnabled) {
            TvSettingRow(
                "Disable password",
                if (methods?.linkedProviders?.isNotEmpty() == true) "Continue signing in with ${methods?.configuredProviderName ?: "your linked provider"}" else "Link another provider before disabling",
                destructive = true,
                onClick = {
                    scope.launch {
                        runCatching { model.api.setPasswordMode(baseUrl, token, false) }
                            .onSuccess { methods = methods?.copy(passwordEnabled = it); message = "Password disabled" }
                            .onFailure { message = it.message }
                    }
                },
            )
        }
        TvSettingRow("Generate new recovery codes", "Old unused codes will stop working", onClick = {
            scope.launch {
                runCatching { model.api.generateRecoveryCodes(baseUrl, token) }
                    .onSuccess { recoveryCodes = it }
                    .onFailure { message = it.message }
            }
        })
        message?.let { Text(it, color = TvColors.AmberSoft, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 14.dp)) }
        TvSectionLabel("Session", Modifier.padding(start = 14.dp, top = 12.dp, bottom = 4.dp))
        TvSettingRow("Sign out", "Removes this account and its cached data from this TV", destructive = true, onClick = { confirmSignOut = true })
    }

    if (confirmSignOut) {
        TvConfirmDialog("Sign out?", "You will need to sign in again on this TV.", "Sign out", onConfirm = { confirmSignOut = false; model.onSignOut() }, onDismiss = { confirmSignOut = false })
    }
    if (changingPassword) {
        var current by remember { mutableStateOf("") }
        var next by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<String?>(null) }
        val first = remember { FocusRequester() }
        Dialog(onDismissRequest = { changingPassword = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            LaunchedEffect(Unit) { first.requestFocusWhenReady() }
            Column(
                Modifier.width(420.dp).background(Color(0xFF18181B), RoundedCornerShape(16.dp))
                    .border(1.dp, TvColors.Hairline, RoundedCornerShape(16.dp)).padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(if (passwordEnabled) "Change password" else "Enable password", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                if (passwordEnabled) {
                    TvTextField(current, { current = it }, "Current password", Modifier.fillMaxWidth().focusRequester(first), password = true, keyboardType = KeyboardType.Password)
                }
                TvTextField(
                    next, { next = it }, "New password",
                    Modifier.fillMaxWidth().then(if (passwordEnabled) Modifier else Modifier.focusRequester(first)),
                    placeholder = "At least 8 characters", password = true, keyboardType = KeyboardType.Password, imeAction = ImeAction.Done,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvButton("Cancel", onClick = { changingPassword = false })
                    TvButton("Save", primary = true, enabled = next.length >= 8, onClick = {
                        scope.launch {
                            runCatching { model.api.setPasswordMode(baseUrl, token, true, next, current.takeIf { passwordEnabled }) }
                                .onSuccess { methods = methods?.copy(passwordEnabled = it); message = "Password saved"; changingPassword = false }
                                .onFailure { error = it.message ?: "Unable to save password" }
                        }
                    })
                }
            }
        }
    }
    if (recoveryCodes.isNotEmpty()) {
        val saved = remember { FocusRequester() }
        Dialog(onDismissRequest = {}, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            LaunchedEffect(Unit) { saved.requestFocusWhenReady() }
            Column(
                Modifier.width(460.dp).background(Color(0xFF18181B), RoundedCornerShape(16.dp))
                    .border(1.dp, TvColors.Hairline, RoundedCornerShape(16.dp)).padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Save your recovery codes", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("Each code works once. Write them down or photograph this screen.", color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium)
                recoveryCodes.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        pair.forEach { Text(it, color = Color.White, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f)) }
                    }
                }
                TvButton("I saved them", primary = true, onClick = { recoveryCodes = emptyList() }, modifier = Modifier.padding(top = 6.dp).focusRequester(saved))
            }
        }
    }
}

// --- Advanced and about -------------------------------------------------------

private fun LazyListScope.advancedSettings(model: TvShellModel, logsOpen: Boolean, onLogs: (Boolean) -> Unit) {
    val preferences = model.preferences
    if (logsOpen) {
        item { TvDebugLogs(model, onClose = { onLogs(false) }) }
        return
    }
    sectionLabel("Startup")
    item { TvSettingToggle("Remember last profile", "Return to the profile used on this device", preferences.rememberLastProfile) { model.onPreferencesChanged(preferences.copy(rememberLastProfile = it)) } }
    sectionLabel("Diagnostics")
    item { TvSettingToggle("Debug logging", "Collect additional local diagnostic information", preferences.debugLogging) { model.onPreferencesChanged(preferences.copy(debugLogging = it)) } }
    item { TvSettingRow("View debug logs", "Playback, stream, and app diagnostics", onClick = { onLogs(true) }) }
}

@Composable
private fun TvDebugLogs(model: TvShellModel, onClose: () -> Unit) {
    val entries by DiagnosticLogStore.entries.collectAsState()
    var category by remember { mutableStateOf("All") }
    var level by remember { mutableStateOf<DiagnosticLevel?>(null) }
    val categories = remember(entries) { listOf("All") + entries.asSequence().map(DiagnosticLogEntry::categoryGroup).distinct().sorted() }
    val filtered = remember(entries, category, level) {
        entries.filter { (category == "All" || it.categoryGroup == category) && (level == null || it.level == level) }
    }
    val visible = remember(filtered) { filtered.takeLast(80) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocusWhenReady() }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TvButton("Back", onClick = onClose, modifier = Modifier.focusRequester(first))
            TvButton("Share", onClick = { model.shareText(DiagnosticLogStore.copyText(filtered)) })
            TvButton("Clear", onClick = { DiagnosticLogStore.clear() })
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(categories) { name -> TvChip(name, selected = category == name, onClick = { category = name }) }
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { TvChip("All levels", selected = level == null, onClick = { level = null }) }
            items(DiagnosticLevel.entries) { entry -> TvChip(entry.label, selected = level == entry, onClick = { level = entry }) }
        }
        Text(
            "Latest ${visible.size} of ${filtered.size} filtered · ${entries.size}/${DiagnosticLogStore.maxEntries} retained · UTC",
            color = TvColors.Muted,
            style = MaterialTheme.typography.bodySmall,
        )
        // Each line is focusable so the D-pad can scroll through the log.
        visible.forEach { entry ->
            TvFocusable(onClick = {}, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
                Text(
                    entry.formatted,
                    color = when (entry.level) {
                        DiagnosticLevel.Error -> MaterialTheme.colorScheme.error
                        DiagnosticLevel.Warn -> Color(0xFFFFC857)
                        else -> Color(0xFFE4E4E7)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
        }
    }
}

private fun LazyListScope.aboutSettings(model: TvShellModel) {
    val platform = model.platform
    sectionLabel("This device")
    item {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("conduit for Android TV", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text("${platform.name} ${platform.version} · ${platform.device}", color = TvColors.Muted, style = MaterialTheme.typography.bodySmall)
            Text(model.state.endpoint?.baseUrl.orEmpty(), color = TvColors.Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
    sectionLabel("Privacy")
    item { TvAboutLine("conduit stores account, profile, library, and viewing data on the server you choose.") }
    item { TvAboutLine("github.com/davidvanderklay/conduit#data-and-privacy-model") }
    sectionLabel("Open source")
    item { TvAboutLine("Contributors are acknowledged through the project repository.") }
    items(licenseNotices(platform.name)) { notice -> TvAboutLine(notice.removePrefix("https://")) }
}

/** Focusable so the D-pad can scroll the About text. */
@Composable
private fun TvAboutLine(text: String) {
    TvFocusable(onClick = {}, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
        Text(text, color = Color(0xFFD4D4D8), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp))
    }
}
