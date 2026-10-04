package media.conduit.mobile.tv

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.FastForward
import androidx.compose.material.icons.rounded.FastRewind
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import media.conduit.mobile.PlaybackCommand
import media.conduit.mobile.PlayerOpeningOverlay
import media.conduit.mobile.TvPlayerModel
import media.conduit.mobile.TvStreamsModel
import media.conduit.mobile.account.PlaybackQueueItem
import media.conduit.mobile.account.ProfileMutation
import media.conduit.mobile.account.VideoItem
import media.conduit.mobile.removeFromQueue
import media.conduit.mobile.skipSegmentLabel

private const val ControlsTimeoutMs = 5_000L
private const val SeekCommitDelayMs = 450L

/** Accumulates D-pad seek presses into one seek so holding a key does not flood the player. */
private class TvSeek(
    private val scope: CoroutineScope,
    private val position: () -> Long,
    private val duration: () -> Long,
    private val commit: (Long) -> Unit,
) {
    var pending by mutableStateOf<Long?>(null)
        private set
    private var job: Job? = null

    fun nudge(deltaMs: Long) {
        val limit = duration().takeIf { it > 0 } ?: return
        pending = ((pending ?: position()) + deltaMs).coerceIn(0L, limit)
        job?.cancel()
        job = scope.launch {
            delay(SeekCommitDelayMs)
            pending?.let(commit)
            // Hold the target until the player reports the new position.
            delay(700)
            pending = null
        }
    }
}

/** Longer holds seek further per repeat. */
private fun seekStepMs(event: KeyEvent): Long = when (event.nativeKeyEvent.repeatCount) {
    in 0..4 -> 10_000L
    in 5..14 -> 30_000L
    else -> 60_000L
}

/**
 * Everything drawn over the video on Android TV: the control bar, seek feedback,
 * skip and up-next prompts, and the source, episode, and queue drawers. With the
 * controls hidden, Left and Right seek, Select toggles playback, and Up or Down
 * brings the controls back.
 */
@Composable
internal fun BoxScope.TvPlayerOverlays(model: TvPlayerModel) {
    val controller = model.controller
    val session = model.session
    val playback = session.playback
    val scope = rememberCoroutineScope()
    val drawerOpen = session.episodePickerOpen || session.streamPicker != null || session.queueOpen
    val blocked = model.opening || model.error != null || drawerOpen || model.engine.panelOpen || model.overlayOpen
    var controlsVisible by remember(session.sessionId) { mutableStateOf(true) }
    var interaction by remember { mutableIntStateOf(0) }
    val rootFocus = remember { FocusRequester() }
    val playFocus = remember { FocusRequester() }
    val promptFocus = remember { FocusRequester() }
    val latestPlayback by rememberUpdatedState(playback)
    val seek = remember(session.sessionId) {
        TvSeek(scope, { latestPlayback.positionMs }, { latestPlayback.durationMs }) {
            controller.send(PlaybackCommand.SeekTo(it))
        }
    }
    val togglePlayback = {
        controller.send(if (latestPlayback.playing) PlaybackCommand.Pause else PlaybackCommand.Play)
    }
    val promptVisible = !blocked && (model.skip != null || model.upNext != null)

    LaunchedEffect(controlsVisible) { model.onControlsVisibilityChanged(controlsVisible) }
    LaunchedEffect(controlsVisible, playback.playing, interaction, blocked) {
        if (controlsVisible && playback.playing && !blocked) {
            delay(ControlsTimeoutMs)
            controlsVisible = false
        }
    }
    // Exactly one target owns focus: a drawer, the control bar, a prompt, or the bare video.
    LaunchedEffect(blocked, controlsVisible, promptVisible) {
        when {
            blocked -> Unit
            controlsVisible -> playFocus.requestFocusWhenReady()
            promptVisible -> promptFocus.requestFocusWhenReady()
            else -> rootFocus.requestFocusWhenReady()
        }
    }
    BackHandler(enabled = controlsVisible && !blocked) { controlsVisible = false }

    Box(
        Modifier
            .matchParentSize()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                interaction++
                when (event.key) {
                    Key.MediaPlayPause -> togglePlayback()
                    Key.MediaPlay -> controller.send(PlaybackCommand.Play)
                    Key.MediaPause -> controller.send(PlaybackCommand.Pause)
                    Key.MediaFastForward -> seek.nudge(seekStepMs(event))
                    Key.MediaRewind -> seek.nudge(-seekStepMs(event))
                    Key.MediaNext -> if (model.hasNext) controller.playNext()
                    else -> return@onPreviewKeyEvent false
                }
                true
            }
            .onKeyEvent { event ->
                if (blocked || controlsVisible || event.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> seek.nudge(-seekStepMs(event))
                    Key.DirectionRight -> seek.nudge(seekStepMs(event))
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                        togglePlayback()
                        controlsVisible = true
                    }
                    Key.DirectionUp, Key.DirectionDown -> controlsVisible = true
                    else -> return@onKeyEvent false
                }
                true
            }
            .focusRequester(rootFocus)
            .focusable(),
    ) {
        if (model.opening) {
            PlayerOpeningOverlay(
                artwork = model.openingArtwork,
                logo = model.openingLogo,
                title = model.openingTitle.orEmpty(),
                status = model.openingStatus,
                modifier = Modifier.matchParentSize(),
            )
        } else if (model.buffering) {
            TvPlayerNotice("Buffering…", Modifier.align(Alignment.Center))
        }
        session.notice?.let { TvPlayerNotice(it, Modifier.align(Alignment.TopCenter).padding(top = TvSpacing.Edge)) }

        val showBar = !blocked && (controlsVisible || seek.pending != null)
        if (showBar) {
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .6f), Color.Transparent, Color.Transparent, Color.Black.copy(alpha = .9f)))))
        }
        if (!blocked && controlsVisible) {
            Column(Modifier.align(Alignment.TopStart).padding(horizontal = 36.dp, vertical = TvSpacing.Edge)) {
                Text(model.request.title, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                model.request.mediaName.takeUnless { it == model.request.title }?.let {
                    Text(it, color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 36.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (promptVisible) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                    model.skip?.let { segment ->
                        TvButton(
                            skipSegmentLabel(segment.type),
                            onClick = { controller.send(PlaybackCommand.SeekTo(segment.endMs)) },
                            icon = Icons.Rounded.FastForward,
                            modifier = Modifier.focusRequester(promptFocus),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    model.upNext?.let { upNext ->
                        TvFocusable(
                            onClick = controller::playNext,
                            onLongClick = model.onDismissUpNext,
                            shape = RoundedCornerShape(14.dp),
                            container = { focused -> if (focused) Color(0xF227272A) else Color(0xE619191B) },
                            modifier = if (model.skip == null) Modifier.focusRequester(promptFocus) else Modifier,
                        ) {
                            Row(Modifier.padding(8.dp).width(300.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                AsyncImage(upNext.nextEpisodeArtwork, null, Modifier.width(84.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                                Column(Modifier.weight(1f)) {
                                    TvSectionLabel(listOfNotNull(if (upNext.nextItemQueued) "Up next" else "Next episode", upNext.episodeLabel).joinToString(" · "))
                                    Text(upNext.nextEpisodeTitle.orEmpty(), color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
            if (showBar) {
                val position = seek.pending ?: playback.positionMs
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(formatTvTime(position), color = Color.White, style = MaterialTheme.typography.labelLarge)
                    TvSeekBar(
                        fraction = if (playback.durationMs > 0) position.toFloat() / playback.durationMs else 0f,
                        focusable = controlsVisible && !controller.partyGuest,
                        onNudge = seek::nudge,
                        modifier = Modifier.weight(1f),
                    )
                    Text(formatTvTime(playback.durationMs), color = Color.White, style = MaterialTheme.typography.labelLarge)
                }
            }
            if (!blocked && controlsVisible) {
                var focusedLabel by remember { mutableStateOf("") }
                @Composable
                fun Action(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, badge: String? = null, modifier: Modifier = Modifier, onClick: () -> Unit) {
                    TvIconButton(icon, label, onClick, modifier.onFocusChanged { if (it.isFocused) focusedLabel = label }, badge = badge)
                }
                @Composable
                fun TextAction(value: String, label: String, onClick: () -> Unit) {
                    TvFocusable(onClick = onClick, shape = RoundedCornerShape(50), modifier = Modifier.height(44.dp).onFocusChanged { if (it.isFocused) focusedLabel = label }) {
                        Text(value, color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.align(Alignment.Center).padding(horizontal = 14.dp))
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (!controller.partyGuest) {
                        Action(Icons.Rounded.FastRewind, "Back 10 seconds") { seek.nudge(-10_000L) }
                    }
                    TvFocusable(
                        onClick = togglePlayback,
                        shape = CircleShape,
                        container = { Color.White },
                        modifier = Modifier.size(48.dp).focusRequester(playFocus)
                            .onFocusChanged { if (it.isFocused) focusedLabel = if (latestPlayback.playing) "Pause" else "Play" },
                    ) {
                        androidx.compose.material3.Icon(
                            if (playback.playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            if (playback.playing) "Pause" else "Play",
                            tint = TvColors.OnAmber,
                            modifier = Modifier.align(Alignment.Center).size(28.dp),
                        )
                    }
                    if (!controller.partyGuest) {
                        Action(Icons.Rounded.FastForward, "Forward 10 seconds") { seek.nudge(10_000L) }
                    }
                    if (model.hasNext) Action(Icons.Rounded.SkipNext, "Next", onClick = controller::playNext)
                    Text(focusedLabel, color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, modifier = Modifier.padding(start = 12.dp).weight(1f))
                    Action(Icons.Rounded.Subtitles, "Subtitles", onClick = model.engine.openSubtitles)
                    Action(Icons.Rounded.Headphones, "Audio", onClick = model.engine.openAudio)
                    if (!controller.partyGuest) TextAction(model.engine.speedLabel, "Playback speed", model.engine.cycleSpeed)
                    TextAction(model.engine.scaleLabel, "Video scale", model.engine.cycleScale)
                    Action(Icons.Rounded.Tune, "Sources", onClick = controller::openSources)
                    if (model.request.hasEpisodes) Action(Icons.AutoMirrored.Rounded.PlaylistPlay, "Episodes", onClick = controller::openEpisodes)
                    val queued = model.snapshot?.queue?.size ?: 0
                    Action(Icons.AutoMirrored.Rounded.QueueMusic, "Queue", badge = queued.takeIf { it > 0 }?.coerceAtMost(99)?.toString(), onClick = controller::openQueue)
                    model.onWatchParty?.let { Action(Icons.Rounded.People, "Watch together", onClick = it) }
                }
            }
        }

        if (drawerOpen) TvPlayerDrawer(model) else model.error?.let { message -> TvPlayerError(model, message) }
    }
}

@Composable
private fun TvPlayerNotice(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Color.White,
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier
            .background(Color(0xF0202022), RoundedCornerShape(10.dp))
            .border(1.dp, TvColors.Hairline, RoundedCornerShape(10.dp))
            .padding(horizontal = 16.dp, vertical = 10.dp),
    )
}

/** The amber timeline. Focused, Left and Right scrub through [onNudge]. */
@Composable
private fun TvSeekBar(fraction: Float, focusable: Boolean, onNudge: (Long) -> Unit, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier
            .height(20.dp)
            .onFocusChanged { focused = it.isFocused }
            .onKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> onNudge(-seekStepMs(event))
                    Key.DirectionRight -> onNudge(seekStepMs(event))
                    else -> return@onKeyEvent false
                }
                true
            }
            .focusable(focusable),
        contentAlignment = Alignment.CenterStart,
    ) {
        val height = if (focused) 8.dp else 4.dp
        Box(Modifier.fillMaxWidth().height(height).background(Color.White.copy(alpha = .28f), RoundedCornerShape(50)))
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(height).background(TvColors.Amber, RoundedCornerShape(50)))
        if (focused) Box(Modifier.fillMaxWidth().height(14.dp).border(2.dp, TvColors.Amber.copy(alpha = .55f), RoundedCornerShape(50)))
    }
}

@Composable
private fun BoxScope.TvPlayerError(model: TvPlayerModel, message: String) {
    val controller = model.controller
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocusWhenReady() }
    Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .58f)))
    Column(
        Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color(0xFA08080A))
            .padding(horizontal = 36.dp, vertical = 24.dp).tvFocusTrap(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Couldn't start this video", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(message, color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TvButton(
                "Retry",
                onClick = if (model.request.autoRecoveryAttempt) controller::retryAutoRecovery else {
                    { controller.send(PlaybackCommand.RetryVideoOutput) }
                },
                primary = true,
                modifier = Modifier.focusRequester(first),
            )
            TvButton("Choose source", onClick = controller::openSources)
            val queue = model.snapshot?.queue.orEmpty()
            queue.firstOrNull { it.mediaId == model.request.identity.mediaId && it.videoId == model.request.identity.videoId }?.let { failed ->
                TvButton("Skip item", onClick = {
                    scope.launch {
                        val remaining = queue.removeFromQueue(failed.key)
                        if (model.onMutation(ProfileMutation.SetQueue(remaining)).isSuccess) {
                            remaining.firstOrNull()?.let(controller::playQueueItem) ?: controller.close()
                        }
                    }
                })
            }
            TvButton("Close", onClick = controller::close)
        }
    }
}

/** Right-side drawer for sources, episodes, or the queue. Back closes it through the session host. */
@Composable
private fun BoxScope.TvPlayerDrawer(model: TvPlayerModel) {
    val controller = model.controller
    val session = model.session
    val focus = remember { FocusRequester() }
    val kind = when {
        session.queueOpen -> "queue"
        session.streamPicker != null -> "streams"
        else -> "episodes"
    }
    LaunchedEffect(kind) { focus.requestFocusWhenReady() }
    Column(
        Modifier
            .align(Alignment.CenterEnd)
            .fillMaxHeight()
            .width(400.dp)
            .background(Color(0xF509090B))
            .padding(horizontal = 16.dp, vertical = TvSpacing.Edge)
            .focusRequester(focus)
            .tvFocusTrap(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val picker = session.streamPicker
        when {
            session.queueOpen -> TvQueueList(
                items = model.snapshot?.queue.orEmpty(),
                onPlay = controller::playQueueItem,
                onChange = { items -> model.onMutation(ProfileMutation.SetQueue(items)) },
            )
            picker != null -> TvStreamsPanel(
                TvStreamsModel(
                    episode = picker.episode.takeUnless { picker.movie },
                    streams = picker.streams,
                    addonChoices = picker.addonChoices,
                    selectedAddonId = picker.selectedAddonId,
                    resumeFrom = picker.resumeFrom,
                    loading = picker.loading,
                    error = picker.error,
                    onSelectAddon = controller::selectStreamAddon,
                    onRetry = controller::retryStreams,
                    onSelect = controller::selectStream,
                ),
                title = model.request.mediaName,
                onBack = if (picker.movie) controller::closeStreamPicker else controller::backToEpisodes,
                focus = remember { FocusRequester() },
            )
            else -> {
                val mediaItem = model.request.mediaItem ?: return@Column
                val videos = model.request.episodes
                val seasons = remember(videos) {
                    videos.mapNotNull(VideoItem::season).distinct().sortedBy { if (it == 0) Int.MAX_VALUE else it }
                }
                val currentId = model.request.identity.videoId
                var season by remember(videos) {
                    mutableStateOf(videos.firstOrNull { it.id == currentId }?.season ?: seasons.firstOrNull())
                }
                val current = remember { FocusRequester() }
                LaunchedEffect(Unit) { current.requestFocusWhenReady() }
                TvSectionLabel("Episodes")
                TvEpisodeList(
                    currentFocus = current,
                    item = mediaItem,
                    videos = videos,
                    snapshot = model.snapshot,
                    seasons = seasons,
                    selectedSeason = season,
                    onSelectSeason = { season = it },
                    scrollToVideoId = currentId,
                    onSelect = { controller.selectEpisode(it.id) },
                )
            }
        }
    }
}

/** The playback queue. Select plays an item; Menu or a long press removes it. */
@Composable
internal fun TvQueueList(
    items: List<PlaybackQueueItem>,
    onPlay: (PlaybackQueueItem) -> Unit,
    onChange: suspend (List<PlaybackQueueItem>) -> Result<Unit>,
) {
    val scope = rememberCoroutineScope()
    // Removing the focused row would strand focus, so it returns to the top of the list after every change.
    val anchor = remember { FocusRequester() }
    LaunchedEffect(items.size) { anchor.requestFocusWhenReady() }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Queue", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (items.isNotEmpty()) TvButton("Clear", onClick = { scope.launch { onChange(emptyList()) } })
    }
    if (items.isEmpty()) {
        // Keeps a focus target in the drawer so Back and the D-pad still have somewhere to land.
        TvFocusable(onClick = {}, modifier = Modifier.fillMaxWidth().focusRequester(anchor)) {
            Text("Your queue is empty", color = TvColors.Muted, modifier = Modifier.padding(12.dp))
        }
        return
    }
    Text("Menu or hold Select to remove", color = TvColors.Dim, style = MaterialTheme.typography.labelMedium)
    LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp), contentPadding = PaddingValues(bottom = 8.dp)) {
        items(items, key = PlaybackQueueItem::key) { queued ->
            TvFocusable(
                onClick = { onPlay(queued) },
                onLongClick = { scope.launch { onChange(items.removeFromQueue(queued.key)) } },
                modifier = Modifier.fillMaxWidth().then(if (queued.key == items.first().key) Modifier.focusRequester(anchor) else Modifier),
            ) {
                Row(Modifier.padding(7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AsyncImage(queued.artwork ?: queued.poster, null, Modifier.width(96.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                    Column(Modifier.weight(1f)) {
                        Text(queued.name, color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOfNotNull(
                                queued.season?.let { "S$it E${queued.episode ?: 0}" },
                                queued.videoTitle,
                            ).joinToString(" · ").ifBlank { "Movie" },
                            color = TvColors.Muted,
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

internal fun formatTvTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1_000
    val hours = seconds / 3_600
    val minutes = seconds % 3_600 / 60
    val remainder = seconds % 60
    return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}"
    else "$minutes:${remainder.toString().padStart(2, '0')}"
}
