package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.interop.UIKitViewController
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.account.SubtitleItem

private data class IosTrack(
    val id: Int,
    val label: String,
    val language: String,
    val external: Boolean = false,
    val selected: Boolean,
)

@OptIn(ExperimentalForeignApi::class)
@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    subtitles: List<SubtitleItem>,
    contentLogo: String?,
    contentTitle: String?,
    hasEpisodes: Boolean,
    touchGestures: Boolean,
    holdToSpeed: Boolean,
    preferredAudioLanguage: String,
    preferredSubtitleLanguage: String,
    onEpisodes: () -> Unit,
    onControlsVisibilityChanged: (Boolean) -> Unit,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val currentCallback by rememberUpdatedState(onState)
    val latestControlsCallback by rememberUpdatedState(onControlsVisibilityChanged)
    val bridge = remember { IosPlayerBridgeFactory.create() }
    val density = LocalDensity.current

    if (bridge == null) {
        LaunchedEffect(Unit) {
            currentCallback(
                PlaybackState(
                    loading = false,
                    error = "The iOS MPVKit player is not registered in this build.",
                ),
            )
        }
        Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
            Text(
                "iOS playback is unavailable in this build.",
                color = Color.White.copy(alpha = .72f),
                modifier = Modifier.padding(24.dp),
            )
        }
        return
    }

    var controlsVisible by remember(bridge) { mutableStateOf(true) }
    var dragging by remember(bridge) { mutableStateOf(false) }
    var draggedPosition by remember(bridge) { mutableLongStateOf(0L) }
    var positionMs by remember(bridge) { mutableLongStateOf(0L) }
    var durationMs by remember(bridge) { mutableLongStateOf(0L) }
    var playing by remember(bridge) { mutableStateOf(false) }
    var playbackSpeed by remember(bridge) { mutableFloatStateOf(1f) }
    var resizeMode by remember(bridge) { mutableIntStateOf(0) }
    var trackPanel by remember(bridge) { mutableStateOf<Int?>(null) }
    var speedMenuOpen by remember(bridge) { mutableStateOf(false) }
    var audioTracks by remember(bridge) { mutableStateOf<List<IosTrack>>(emptyList()) }
    var subtitleTracks by remember(bridge) { mutableStateOf<List<IosTrack>>(emptyList()) }

    val encodedHeaders = remember(requestHeaders) {
        Json.encodeToString<Map<String, String>>(requestHeaders)
    }
    val encodedSubtitles = remember(subtitles) {
        Json.encodeToString(subtitles)
    }

    LaunchedEffect(bridge, url, encodedHeaders, encodedSubtitles, startPositionMs) {
        url?.takeIf(String::isNotBlank)?.let {
            bridge.loadFile(
                url = it,
                initialPositionMs = startPositionMs.coerceAtLeast(0),
                headersJson = encodedHeaders,
                subtitlesJson = encodedSubtitles,
            )
            if (active) bridge.play() else bridge.pause()
        }
    }

    LaunchedEffect(bridge, active) {
        if (active) bridge.play() else bridge.pause()
    }

    LaunchedEffect(bridge, resizeMode) {
        bridge.setResizeMode(resizeMode)
    }

    LaunchedEffect(bridge, preferredAudioLanguage) {
        bridge.setPreferredAudioLanguage(preferredAudioLanguage)
    }

    LaunchedEffect(bridge, preferredSubtitleLanguage) {
        bridge.setPreferredSubtitleLanguage(preferredSubtitleLanguage)
    }

    LaunchedEffect(controlsVisible) {
        latestControlsCallback(controlsVisible)
    }

    LaunchedEffect(bridge) {
        while (isActive) {
            val next = PlaybackState(
                loading = bridge.getIsLoading(),
                buffering = bridge.getIsBuffering(),
                playing = bridge.getIsPlaying(),
                positionMs = bridge.getPositionMs().coerceAtLeast(0),
                durationMs = bridge.getDurationMs().coerceAtLeast(0),
                ended = bridge.getIsEnded(),
                error = bridge.getErrorMessage().ifBlank { null },
            )
            currentCallback(next)
            if (!dragging) positionMs = next.positionMs
            durationMs = next.durationMs
            playing = next.playing
            playbackSpeed = bridge.getPlaybackSpeed()
            delay(500)
        }
    }

    LaunchedEffect(bridge, trackPanel) {
        if (trackPanel == null) return@LaunchedEffect
        while (isActive) {
            audioTracks = bridge.readAudioTracks()
            subtitleTracks = bridge.readSubtitleTracks()
            delay(500)
        }
    }

    LaunchedEffect(controlsVisible, playing, speedMenuOpen) {
        if (controlsVisible && playing && !speedMenuOpen) {
            delay(4_000)
            controlsVisible = false
        }
    }

    DisposableEffect(bridge) {
        onDispose { bridge.destroy() }
    }

    Box(
        modifier
            .background(Color.Black)
            .pointerInput(bridge, resizeMode) {
                detectTransformGestures { _, _, zoom, _ ->
                    val next = when {
                        zoom > 1.04f -> 2
                        zoom < .96f -> 0
                        else -> resizeMode
                    }
                    if (next != resizeMode) resizeMode = next
                }
            }
            .pointerInput(bridge, touchGestures, holdToSpeed) {
                detectTapGestures(
                    onPress = {
                        if (holdToSpeed) {
                            coroutineScope {
                                val release = async { tryAwaitRelease() }
                                delay(450)
                                if (!release.isCompleted) {
                                    val previousSpeed = playbackSpeed
                                    bridge.setPlaybackSpeed(2f)
                                    release.await()
                                    bridge.setPlaybackSpeed(previousSpeed)
                                }
                            }
                        } else {
                            tryAwaitRelease()
                        }
                    },
                    onTap = { controlsVisible = !controlsVisible },
                    onDoubleTap = if (touchGestures) {
                        { offset ->
                            if (offset.x < size.width / 2f) bridge.seekBy(-10_000) else bridge.seekBy(10_000)
                            controlsVisible = true
                        }
                    } else null,
                )
            },
    ) {
        UIKitViewController(
            factory = { bridge.createPlayerViewController() },
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { size ->
                    if (size.width > 1 && size.height > 1) {
                        bridge.syncVideoSurfaceLayout(
                            width = with(density) { size.width.toDp().value.toDouble() },
                            height = with(density) { size.height.toDp().value.toDouble() },
                        )
                    }
                },
            interactive = false,
        )

        if (controlsVisible) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = .42f)),
            ) {
                Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically) {
                    FilledIconButton(
                        onClick = {
                            if (playing) {
                                bridge.pause()
                                playing = false
                            } else {
                                bridge.play()
                                playing = true
                            }
                            controlsVisible = true
                        },
                        modifier = Modifier.size(64.dp),
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = Color.White,
                            contentColor = Color.Black,
                        ),
                    ) {
                        Icon(
                            if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            if (playing) "Pause" else "Play",
                            modifier = Modifier.size(38.dp),
                        )
                    }
                }

                Column(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                ) {
                    Slider(
                        value = (if (dragging) draggedPosition else positionMs).toFloat(),
                        onValueChange = {
                            dragging = true
                            draggedPosition = it.toLong()
                        },
                        onValueChangeFinished = {
                            bridge.seekTo(draggedPosition)
                            positionMs = draggedPosition
                            dragging = false
                            controlsVisible = true
                        },
                        valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.primary,
                            activeTrackColor = MaterialTheme.colorScheme.primary,
                            inactiveTrackColor = Color.White.copy(alpha = .35f),
                        ),
                        modifier = Modifier.height(30.dp),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        IosPlayerTimePill(formatPlayerTime(if (dragging) draggedPosition else positionMs))
                        IosPlayerTimePill(formatPlayerTime(durationMs))
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        val haptics = LocalHapticFeedback.current
                        val speeds = listOf(.5f, .75f, 1f, 1.25f, 1.5f, 2f)
                        Box {
                            IosPlayerBottomAction(
                                Icons.Rounded.Speed,
                                "${playbackSpeed.trimSpeed()}×",
                                onLongClick = {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    speedMenuOpen = true
                                    controlsVisible = true
                                },
                            ) {
                                val index = speeds.indexOfFirst { it == playbackSpeed }.takeIf { it >= 0 } ?: 2
                                val next = speeds[(index + 1) % speeds.size]
                                bridge.setPlaybackSpeed(next)
                                playbackSpeed = next
                                controlsVisible = true
                            }
                            DropdownMenu(
                                expanded = speedMenuOpen,
                                onDismissRequest = { speedMenuOpen = false },
                            ) {
                                speeds.forEach { speed ->
                                    DropdownMenuItem(
                                        text = { Text("${speed.trimSpeed()}×") },
                                        leadingIcon = if (speed == playbackSpeed) {{ Icon(Icons.Rounded.Check, null) }} else null,
                                        onClick = {
                                            bridge.setPlaybackSpeed(speed)
                                            playbackSpeed = speed
                                            speedMenuOpen = false
                                            controlsVisible = true
                                        },
                                    )
                                }
                            }
                        }
                        IosPlayerBottomAction(Icons.Rounded.Headphones, "Audio") {
                            trackPanel = 0
                            controlsVisible = true
                        }
                        IosPlayerBottomAction(Icons.Rounded.Subtitles, "Subtitles") {
                            trackPanel = 1
                            controlsVisible = true
                        }
                        if (hasEpisodes) {
                            IosPlayerBottomAction(Icons.Rounded.PlaylistPlay, "Episodes", onClick = onEpisodes)
                        }
                    }
                }
            }
        }

        trackPanel?.let { panel ->
            if (panel == 1) {
                IosSubtitlePanel(
                    tracks = subtitleTracks,
                    preferredLanguage = preferredSubtitleLanguage,
                    onSelect = bridge::selectSubtitleTrack,
                    onDismiss = { trackPanel = null },
                )
            } else {
                IosPlayerTrackPanel(
                    title = "Audio tracks",
                    tracks = audioTracks,
                    selectedId = audioTracks.firstOrNull { it.selected }?.id,
                    allowOff = false,
                    onSelect = { trackId ->
                        bridge.selectAudioTrack(trackId)
                        trackPanel = null
                    },
                    onDismiss = { trackPanel = null },
                )
            }
        }
    }
}

private fun IosPlayerBridge.readAudioTracks(): List<IosTrack> =
    (0 until getAudioTrackCount()).map { index ->
        IosTrack(
            id = getAudioTrackId(index),
            label = getAudioTrackLabel(index).ifBlank { "Audio ${index + 1}" },
            language = getAudioTrackLang(index),
            selected = isAudioTrackSelected(index),
        )
    }

private fun IosPlayerBridge.readSubtitleTracks(): List<IosTrack> =
    (0 until getSubtitleTrackCount()).map { index ->
        IosTrack(
            id = getSubtitleTrackId(index),
            label = getSubtitleTrackLabel(index).ifBlank { "Subtitle ${index + 1}" },
            language = getSubtitleTrackLang(index),
            external = isSubtitleTrackExternal(index),
            selected = isSubtitleTrackSelected(index),
        )
    }

@Composable
private fun IosPlayerTimePill(value: String) {
    Surface(
        color = Color.Black.copy(alpha = .65f),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = .22f)),
    ) {
        Text(
            value,
            color = Color.White,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun IosPlayerBottomAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier.combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, label, tint = Color.White)
        Spacer(Modifier.width(5.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun BoxScope.IosPlayerTrackPanel(
    title: String,
    tracks: List<IosTrack>,
    selectedId: Int?,
    allowOff: Boolean,
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
        Modifier
            .align(Alignment.Center)
            .fillMaxWidth(.88f)
            .fillMaxHeight(.72f)
            .clickable(onClick = {}),
        color = Color(0xF21A1A1D),
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 20.dp,
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = Color.White, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Rounded.Close, "Close", tint = Color.White)
                }
            }
            if (tracks.isEmpty() && !allowOff) {
                Text("No tracks were reported by mpv yet.", color = Color.White.copy(alpha = .65f))
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (allowOff) {
                        item {
                            IosPlayerTrackRow("Off", selectedId == null) { onSelect(-1) }
                        }
                    }
                    items(tracks, key = { it.id }) { track ->
                        IosPlayerTrackRow(
                            label = listOf(track.label, track.language).filter(String::isNotBlank).joinToString(" · "),
                            selected = track.id == selectedId,
                            onClick = { onSelect(track.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BoxScope.IosSubtitlePanel(
    tracks: List<IosTrack>,
    preferredLanguage: String,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val orderedTracks = remember(tracks) {
        tracks.sortedWith(compareBy<IosTrack> { it.external }.thenBy { it.variantName.lowercase() })
    }
    val preferredKey = remember(preferredLanguage) { iosSubtitleLanguageKey(preferredLanguage, preferredLanguage) }
    val languageGroups = remember(orderedTracks, preferredKey) {
        orderedTracks
            .groupBy { it.languageKey }
            .toList()
            .sortedWith(
                compareBy<Pair<String, List<IosTrack>>> { if (it.first == preferredKey) 0 else 1 }
                    .thenBy { if (it.first == "und") 1 else 0 }
                    .thenBy { it.second.first().languageName },
            )
    }
    val reportedSelectedId = tracks.firstOrNull { it.selected }?.id
    var selectedTrackId by remember { mutableStateOf(reportedSelectedId) }
    var language by remember {
        mutableStateOf(
            tracks.firstOrNull { it.id == reportedSelectedId }?.languageKey
                ?: languageGroups.firstOrNull()?.first,
        )
    }
    LaunchedEffect(reportedSelectedId) {
        selectedTrackId = reportedSelectedId
        tracks.firstOrNull { it.id == reportedSelectedId }?.let { language = it.languageKey }
    }

    fun choose(track: IosTrack) {
        language = track.languageKey
        selectedTrackId = track.id
        onSelect(track.id)
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 700.dp && maxHeight >= 500.dp
        if (expanded) {
            Box(
                Modifier.fillMaxSize().background(Color.Black.copy(alpha = .52f))
                    .clickable(onClick = onDismiss),
            )
        }
        Surface(
            modifier = if (expanded) {
                Modifier.align(Alignment.Center).fillMaxWidth(.9f).fillMaxHeight(.8f)
                    .widthIn(max = 1_100.dp).heightIn(max = 760.dp)
                    .clickable(onClick = {})
            } else {
                Modifier.fillMaxSize()
            },
            color = Color(0xFA0D0C12),
            shape = if (expanded) RoundedCornerShape(24.dp) else RoundedCornerShape(0.dp),
            shadowElevation = if (expanded) 24.dp else 0.dp,
        ) {
          Box {
            Row(
                Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 30.dp, vertical = 28.dp),
                horizontalArrangement = Arrangement.spacedBy(30.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Subtitle Languages", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(18.dp))
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        item {
                            IosPlayerTrackRow("Disabled", selectedTrackId == null) {
                                selectedTrackId = null
                                onSelect(-1)
                            }
                        }
                        languageGroups.forEach { (code, variants) ->
                            item(code) {
                                IosPlayerTrackRow(
                                    variants.first().languageName,
                                    selectedTrackId != null && language == code,
                                ) { choose(variants.first()) }
                            }
                        }
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text("Subtitle Variants", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(18.dp))
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        orderedTracks.filter { it.languageKey == language }.forEach { track ->
                            item(track.id) {
                                IosPlayerTrackRow(track.variantName, selectedTrackId == track.id) { choose(track) }
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
            IconButton(onClick = onDismiss, Modifier.align(Alignment.TopEnd).safeDrawingPadding().padding(12.dp)) {
                Icon(Icons.Rounded.Close, "Close", tint = Color.White, modifier = Modifier.size(34.dp))
            }
          }
        }
    }
}

private val IosTrack.languageKey: String
    get() = iosSubtitleLanguageKey(language, label)

private val IosTrack.languageName: String
    get() = when (languageKey) {
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
        else -> label.ifBlank { "Unknown language" }
    }

private val IosTrack.variantName: String
    get() {
        if (external) return "${label.ifBlank { "Add-on subtitle" }} · External"
        val normalized = label.substringBefore('(').substringBefore('[').trim().lowercase()
        return if (label.isBlank() || iosSubtitleLanguageKey(normalized, normalized) == languageKey) {
            "Embedded"
        } else {
            "$label · Embedded"
        }
    }

private fun iosSubtitleLanguageKey(language: String, label: String): String {
    val aliases = mapOf(
        "eng" to "en", "english" to "en", "spa" to "es", "spanish" to "es", "español" to "es",
        "fra" to "fr", "fre" to "fr", "french" to "fr", "deu" to "de", "ger" to "de", "german" to "de",
        "ita" to "it", "italian" to "it", "por" to "pt", "portuguese" to "pt", "nld" to "nl", "dut" to "nl", "dutch" to "nl",
        "jpn" to "ja", "japanese" to "ja", "kor" to "ko", "korean" to "ko", "zho" to "zh", "chi" to "zh", "chinese" to "zh",
        "rus" to "ru", "russian" to "ru", "ara" to "ar", "arabic" to "ar", "hin" to "hi", "hindi" to "hi",
        "ind" to "id", "indonesian" to "id", "vie" to "vi", "vietnamese" to "vi",
    )
    fun normalize(value: String): String {
        val normalized = value.trim().lowercase().replace('_', '-').substringBefore('-')
        return aliases[normalized] ?: normalized.takeIf { it.length == 2 }.orEmpty()
    }
    return normalize(language).ifBlank {
        normalize(label.substringBefore('(').substringBefore('[').trim()).ifBlank { "und" }
    }
}

@Composable
private fun IosPlayerTrackRow(label: String, selected: Boolean, onClick: () -> Unit) {
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

private fun Float.trimSpeed(): String =
    if (this % 1f == 0f) toInt().toString() else toString().trimEnd('0').trimEnd('.')

private fun formatPlayerTime(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1_000).coerceAtLeast(0)
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "$hours:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    } else {
        "$minutes:${seconds.toString().padStart(2, '0')}"
    }
}
