package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.C

@Composable
internal fun BoxScope.MpvTrackPanel(
    view: ConduitMpvView,
    type: Int,
    revision: Int,
    preferredSubtitleLanguage: String,
    onSubtitleSelectionChanged: (String?, String?, String?, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val tracks = remember(view, type, revision) {
        view.tracks(if (type == C.TRACK_TYPE_AUDIO) "audio" else "sub")
    }
    if (type == C.TRACK_TYPE_AUDIO) {
        MpvAudioTrackPanel(tracks = tracks, onSelect = view::selectAudio, onDismiss = onDismiss)
    } else {
        MpvSubtitlePanel(
            tracks = tracks,
            preferredLanguage = preferredSubtitleLanguage,
            view = view,
            onSubtitleSelectionChanged = onSubtitleSelectionChanged,
            onDismiss = onDismiss,
        )
    }
}

@Composable
private fun BoxScope.MpvAudioTrackPanel(
    tracks: List<MpvTrack>,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    Box(
        Modifier
            .matchParentSize()
            .background(Color.Black.copy(alpha = .32f))
            .clickable(onClick = onDismiss),
    )
    Surface(
        modifier = Modifier
            .align(Alignment.Center)
            .fillMaxWidth(.88f)
            .fillMaxHeight(.72f)
            .widthIn(max = 1_100.dp)
            .heightIn(max = 760.dp)
            .clickable(onClick = {}),
        color = Color(0xF21A1A1D),
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 20.dp,
    ) {
        Column(Modifier.padding(18.dp)) {
            MpvPanelHeader(title = "Audio tracks", onDismiss = onDismiss)
            if (tracks.isEmpty()) {
                Text("Loading audio tracks…", color = Color.White.copy(alpha = .65f))
            } else {
                LazyColumn(
                    modifier = Modifier.padding(top = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(tracks, key = { "audio:${it.id}" }) { track ->
                        MpvAudioTrackRow(track = track, onClick = { onSelect(track.id); onDismiss() })
                    }
                }
            }
        }
    }
}

@Composable
private fun MpvAudioTrackRow(track: MpvTrack, onClick: () -> Unit) {
    val primary = track.label.ifBlank { "Audio ${track.id}" }
    val secondary = listOfNotNull(
        track.language?.takeIf(String::isNotBlank)?.let { mpvLanguageName(mpvSubtitleLanguageKey(it, it)) },
        if (track.forced) "Forced" else null,
    ).joinToString(" · ")
    Surface(
        onClick = onClick,
        color = if (track.selected) MaterialTheme.colorScheme.primary.copy(alpha = .18f) else Color.White.copy(alpha = .05f),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(primary, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (secondary.isNotBlank()) Text(secondary, color = Color.White.copy(alpha = .6f), style = MaterialTheme.typography.bodySmall)
            }
            if (track.selected) Icon(Icons.Rounded.Check, "Selected", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun BoxScope.MpvSubtitlePanel(
    tracks: List<MpvTrack>,
    preferredLanguage: String,
    view: ConduitMpvView,
    onSubtitleSelectionChanged: (String?, String?, String?, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val orderedTracks = remember(tracks) {
        tracks.sortedWith(
            compareBy<MpvTrack> { if (it.isEmbeddedSubtitle()) 1 else 0 }
                .thenBy { it.label.lowercase() },
        )
    }
    val preferredKey = remember(preferredLanguage) { mpvSubtitleLanguageKey(preferredLanguage, preferredLanguage) }
    val languageGroups = remember(orderedTracks, preferredKey) {
        orderedTracks
            .groupBy { mpvSubtitleLanguageKey(it.language, it.label) }
            .toList()
            .sortedWith(
                compareBy<Pair<String, List<MpvTrack>>> { if (it.first == preferredKey) 0 else 1 }
                    .thenBy { if (it.first == "und") 1 else 0 }
                    .thenBy { it.second.first().mpvLanguageName() },
            )
    }
    val reportedSelectedId = tracks.firstOrNull { it.selected }?.id
    var selectedTrackId by remember(tracks) { mutableStateOf(reportedSelectedId) }
    var language by remember(tracks, preferredKey) {
        mutableStateOf(
            tracks.firstOrNull { it.id == reportedSelectedId }?.let { mpvSubtitleLanguageKey(it.language, it.label) }
                ?: languageGroups.firstOrNull()?.first
                ?: preferredKey,
        )
    }
    LaunchedEffect(reportedSelectedId) {
        selectedTrackId = reportedSelectedId
        tracks.firstOrNull { it.id == reportedSelectedId }?.let {
            language = mpvSubtitleLanguageKey(it.language, it.label)
        }
    }

    fun choose(track: MpvTrack) {
        language = mpvSubtitleLanguageKey(track.language, track.label)
        selectedTrackId = track.id
        view.selectSubtitle(track.id, track.selectionKey, true)
        onSubtitleSelectionChanged(track.selectionKey, track.language, track.label, true)
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 700.dp && maxHeight >= 500.dp
        if (expanded) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = .52f))
                    .clickable(onClick = onDismiss),
            )
        }
        Surface(
            modifier = if (expanded) {
                Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth(.9f)
                    .fillMaxHeight(.8f)
                    .widthIn(max = 1_100.dp)
                    .heightIn(max = 760.dp)
                    .clickable(onClick = {})
            } else {
                Modifier.fillMaxSize()
            },
            color = Color(0xFA0D0C12),
            shape = if (expanded) RoundedCornerShape(24.dp) else RoundedCornerShape(0.dp),
            shadowElevation = if (expanded) 24.dp else 0.dp,
        ) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Subtitles", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White, modifier = Modifier.size(30.dp)) }
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 18.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(30.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Subtitle Languages", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(18.dp))
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            item {
                                MpvTrackRow("Disabled", selectedTrackId == null) {
                                    selectedTrackId = null
                                    view.selectSubtitle(null, null, false)
                                    onSubtitleSelectionChanged(null, null, null, false)
                                }
                            }
                            languageGroups.forEach { (code, variants) ->
                                item(code) {
                                    MpvTrackRow(
                                        variants.first().mpvLanguageName(),
                                        selectedTrackId != null && language == code,
                                    ) { choose(variants.first()) }
                                }
                            }
                            if (languageGroups.isEmpty()) {
                                item { Text("Loading subtitles…", color = Color.White.copy(alpha = .65f)) }
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Subtitle Variants", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(18.dp))
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            orderedTracks.filter { mpvSubtitleLanguageKey(it.language, it.label) == language }.forEach { track ->
                                item(track.id) {
                                    MpvTrackRow(track.mpvVariantName(), selectedTrackId == track.id) { choose(track) }
                                }
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Subtitle Settings", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.weight(1f))
                        Text(
                            "Subtitle appearance is controlled by conduit Settings. Your language, size, position, and outline preferences apply across playback.",
                            color = Color.White.copy(alpha = .72f),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun MpvPanelHeader(title: String, onDismiss: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = Color.White, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
    }
}

@Composable
private fun MpvTrackRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .18f) else Color.White.copy(alpha = .05f),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = Color.White, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Rounded.Check, "Selected", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

private fun MpvTrack.isEmbeddedSubtitle(): Boolean = selectionKey?.startsWith("embedded:") == true

private fun MpvTrack.mpvLanguageName(): String = mpvLanguageName(mpvSubtitleLanguageKey(language, label))

private fun MpvTrack.mpvVariantName(): String {
    val title = label.ifBlank { "Subtitle $id" }
    return if (isEmbeddedSubtitle()) {
        val normalized = mpvSubtitleLanguageKey(null, title)
        if (normalized == mpvSubtitleLanguageKey(language, title)) "Embedded" else "$title · Embedded"
    } else {
        "$title · External"
    }
}

private fun mpvSubtitleLanguageKey(language: String?, label: String): String {
    val aliases = mapOf(
        "eng" to "en", "english" to "en", "spa" to "es", "spanish" to "es", "español" to "es",
        "fra" to "fr", "fre" to "fr", "french" to "fr", "deu" to "de", "ger" to "de", "german" to "de",
        "jpn" to "ja", "japanese" to "ja", "kor" to "ko", "korean" to "ko", "zho" to "zh", "chi" to "zh", "chinese" to "zh",
        "rus" to "ru", "russian" to "ru", "ara" to "ar", "arabic" to "ar", "hin" to "hi", "hindi" to "hi",
        "ind" to "id", "indonesian" to "id", "vie" to "vi", "vietnamese" to "vi",
    )
    fun normalize(value: String): String {
        val normalized = value.trim().lowercase().replace('_', '-').substringBefore('-')
        return aliases[normalized] ?: normalized.takeIf { it.length == 2 }.orEmpty()
    }
    return normalize(language.orEmpty()).ifBlank {
        normalize(label.substringBefore('·').substringBefore('(').substringBefore('[')).ifBlank { "und" }
    }
}

private fun mpvLanguageName(key: String): String = when (key) {
    "en" -> "English"
    "es" -> "Spanish"
    "fr" -> "French"
    "de" -> "German"
    "it" -> "Italian"
    "pt" -> "Portuguese"
    "nl" -> "Dutch"
    "ja" -> "Japanese"
    "ko" -> "Korean"
    "zh" -> "Chinese"
    "ru" -> "Russian"
    "ar" -> "Arabic"
    "hi" -> "Hindi"
    "id" -> "Indonesian"
    "vi" -> "Vietnamese"
    else -> key.takeUnless { it == "und" }?.uppercase() ?: "Unknown language"
}
