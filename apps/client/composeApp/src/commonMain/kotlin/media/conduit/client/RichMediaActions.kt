package media.conduit.client

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Clock
import media.conduit.client.account.*

internal enum class MediaActionContext { Browse, Library, Continue, History, Episode, Season }

internal data class MediaActionTarget(
    val item: CatalogItem,
    val context: MediaActionContext,
    val progress: ProgressSummary? = null,
    val video: VideoItem? = null,
    val canPlay: Boolean = true,
    val season: Int? = null,
    val videos: List<VideoItem> = emptyList(),
)

internal fun LibraryItemSummary.asCatalogItem() = CatalogItem(
    id = id,
    type = type,
    name = name,
    poster = poster,
    background = background,
    description = description,
    releaseInfo = releaseInfo,
)

internal fun MetaItem.asCatalogItem() = CatalogItem(
    id = id,
    type = type,
    name = name,
    poster = poster,
    background = background,
    description = description,
    releaseInfo = releaseInfo,
)

internal class WatchMetadataCache(
    private val api: ConduitApi,
    private val addons: List<InstalledAddonSummary>,
) {
    private val requests = Semaphore(4)
    private val loading = mutableSetOf<String>()
    private val metadata = mutableStateMapOf<String, MetaItem>()

    suspend fun load(item: CatalogItem, includeMovies: Boolean = false) {
        val key = "${item.type}:${item.id}"
        if ((item.type != "series" && !includeMovies) || metadata.containsKey(key) || !loading.add(key)) return
        try {
            requests.withPermit {
                repeat(3) { attempt ->
                    val loaded = runCatching { api.loadMeta(addons, item.type, item.id) }.getOrNull()
                    if (loaded != null) {
                        metadata[key] = loaded
                        return@withPermit
                    }
                    if (attempt < 2) delay(400L * (attempt + 1))
                }
            }
        } finally {
            loading.remove(key)
        }
    }

    fun metadataFor(item: CatalogItem): MetaItem? = metadata["${item.type}:${item.id}"]

    fun videosFor(item: CatalogItem): List<VideoItem> = metadataFor(item)?.videos.orEmpty()
}

internal fun progressDisplayTitle(progress: ProgressSummary, metadataName: String? = null): String =
    metadataName?.takeIf(String::isNotBlank)
        ?: progress.name.substringBefore("  ·  ").substringBefore(" · ").trim()

@Composable
internal fun rememberWatchMetadataCache(
    api: ConduitApi,
    addons: List<InstalledAddonSummary>,
): WatchMetadataCache = remember(api, addons) { WatchMetadataCache(api, addons) }

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ContinueWatchingCard(
    progress: ProgressSummary,
    item: CatalogItem,
    metadata: MetaItem?,
    metadataReady: Boolean,
    watchedVideoIds: Set<String> = emptySet(),
    onClick: () -> Unit,
    onActions: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val displayTitle = progressDisplayTitle(progress, metadata?.name)
    val presentation = continueWatchingPresentation(
        progress = progress,
        videos = metadata?.videos.orEmpty(),
        watchedVideoIds = watchedVideoIds,
    )
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val cardScale by animateFloatAsState(if (pressed) .98f else 1f, label = "continue-card-press")
    val haptics = LocalHapticFeedback.current
    val video = presentation.video
    val artworkSources = listOfNotNull(
        video?.thumbnail?.let { it to ContentScale.Crop },
        metadata?.background?.let { it to ContentScale.Crop },
        metadata?.poster?.let { it to ContentScale.Fit },
        item.poster?.let { it to ContentScale.Fit },
    ).distinct()
    var artworkIndex by remember(artworkSources) { mutableIntStateOf(0) }
    val artwork = artworkSources.getOrNull(artworkIndex)
    val badge = continueWatchingBadgeLabel(progress, presentation, metadataReady)
    val season = video?.season ?: progress.season
    val episode = video?.episode ?: progress.episode
    val episodeTitle = video?.title ?: video?.name ?: progress.videoTitle

    Box(
        modifier.scale(cardScale).aspectRatio(16f / 9f).clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                onClickLabel = when (presentation.kind) {
                    ContinueWatchingKind.InProgress -> "Resume $displayTitle"
                    ContinueWatchingKind.NewEpisode -> "Play the new episode of $displayTitle"
                    ContinueWatchingKind.NextUp -> "Play the next episode of $displayTitle"
                    ContinueWatchingKind.Scheduled -> "View $displayTitle, next episode ${presentation.label}"
                    ContinueWatchingKind.CaughtUp -> "View $displayTitle, caught up"
                },
                onLongClickLabel = "More actions for $displayTitle",
                onClick = onClick,
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onActions()
                },
            ),
    ) {
        if (artwork?.second == ContentScale.Fit) {
            AsyncImage(
                model = artwork.first,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alpha = .38f,
                modifier = Modifier.fillMaxSize(),
            )
        }
        AsyncImage(
            model = artwork?.first,
            contentDescription = displayTitle,
            contentScale = artwork?.second ?: ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
            onError = { artworkIndex += 1 },
        )
        if (artwork == null) {
            Text(
                displayTitle.take(1),
                modifier = Modifier.align(Alignment.Center),
                style = MaterialTheme.typography.displayMedium,
                color = Color.White.copy(alpha = .24f),
            )
        }
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    listOf(Color.Transparent, Color.Black.copy(alpha = .12f), Color.Black.copy(alpha = .9f)),
                ),
            ),
        )
        Surface(
            modifier = Modifier.align(Alignment.TopEnd).padding(7.dp),
            shape = RoundedCornerShape(6.dp),
            color = if (presentation.kind == ContinueWatchingKind.NewEpisode) {
                Color(0xFF1D5DDD)
            } else {
                Color.Black.copy(alpha = .82f)
            },
            contentColor = Color.White,
            shadowElevation = 5.dp,
        ) {
            Text(
                badge,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Column(
            modifier = Modifier.align(Alignment.BottomStart).padding(start = 10.dp, end = 10.dp, bottom = 9.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            if (progress.mediaType == "series" && season != null && episode != null) {
                Text(
                    "S$season E$episode",
                    color = Color.White,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                displayTitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
            episodeTitle?.let {
                Text(
                    it,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = Color.White.copy(alpha = .72f),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        if (presentation.kind == ContinueWatchingKind.InProgress) {
            ProgressRail(progress, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun RichPosterCard(
    item: CatalogItem,
    caption: String,
    snapshot: ProfileSnapshot?,
    metadataCache: WatchMetadataCache,
    onClick: () -> Unit,
    onActions: () -> Unit,
    modifier: Modifier = Modifier,
    showLabels: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val cardScale by animateFloatAsState(if (pressed) .97f else 1f, label = "media-card-press")
    val haptics = LocalHapticFeedback.current
    val progress = latestProgress(snapshot, item)
    val displayTitle = progress?.let { progressDisplayTitle(it, metadataCache.metadataFor(item)?.name) }
        ?: item.name
    Column(
        modifier.scale(cardScale).combinedClickable(
            interactionSource = interaction,
            indication = null,
            onClickLabel = "Open $displayTitle",
            onLongClickLabel = "More actions for $displayTitle",
            onClick = onClick,
            onLongClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onActions()
            },
        ),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            AsyncImage(
                model = item.poster,
                contentDescription = displayTitle,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier.fillMaxWidth().height(48.dp).align(Alignment.BottomCenter)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .72f)))),
            )
            PosterWatchStatus(item, snapshot, metadataCache, Modifier.align(Alignment.TopStart).padding(6.dp))
            ProgressRail(progress, Modifier.align(Alignment.BottomCenter))
        }
        if (showLabels) {
            Text(
                displayTitle,
                minLines = 2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(caption.replaceFirstChar(Char::uppercase), maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun RichProgressCard(
    progress: ProgressSummary,
    onClick: () -> Unit,
    onActions: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val displayTitle = progressDisplayTitle(progress)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val cardScale by animateFloatAsState(if (pressed) .98f else 1f, label = "progress-card-press")
    val haptics = LocalHapticFeedback.current
    Column(
        modifier.scale(cardScale).combinedClickable(
            interactionSource = interaction,
            indication = null,
            onClickLabel = "Resume $displayTitle",
            onLongClickLabel = "More actions for $displayTitle",
            onClick = onClick,
            onLongClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onActions()
            },
        ),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF342B55), Color(0xFF17151E)))))
            AsyncImage(progress.poster, displayTitle, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            if (progress.poster == null) {
                Text(displayTitle.take(1), modifier = Modifier.align(Alignment.Center), style = MaterialTheme.typography.displayMedium, color = Color.White.copy(alpha = .24f))
            }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .45f)))))
            ProgressRail(progress, Modifier.align(Alignment.BottomCenter))
        }
        Text(displayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
        Text(
            progress.videoTitle ?: listOfNotNull(progress.season?.let { "S$it" }, progress.episode?.let { "E$it" })
                .joinToString(" · ").ifBlank { "${progress.positionMs / 60_000} min watched" },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun PosterWatchStatus(
    item: CatalogItem,
    snapshot: ProfileSnapshot?,
    metadataCache: WatchMetadataCache,
    modifier: Modifier = Modifier,
) {
    val mediaProgress = snapshot?.progress.orEmpty().filter { it.mediaType == item.type && it.mediaId == item.id }
    LaunchedEffect(item.type, item.id, mediaProgress.isNotEmpty()) {
        if (mediaProgress.isNotEmpty()) metadataCache.load(item)
    }
    val state = posterWatchState(snapshot?.progress.orEmpty(), item, completionEpisodeIds(metadataCache.videosFor(item)))
    if (state == PosterWatchState.Unwatched) return
    val complete = state == PosterWatchState.Complete
    Surface(
        modifier = modifier.size(24.dp),
        shape = CircleShape,
        color = if (complete) Color(0xFF39D98A) else Color(0xFFFFBD00),
        contentColor = if (complete) Color(0xFF002C18) else Color(0xFF241900),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(if (complete) Icons.Rounded.Check else Icons.Rounded.Remove, if (complete) "Complete" else "Partially watched", Modifier.size(15.dp))
        }
    }
}

@Composable
private fun ProgressRail(progress: ProgressSummary?, modifier: Modifier = Modifier) {
    if (progress == null || progress.watched || progress.durationMs <= 0 || progress.positionMs <= 0) return
    LinearProgressIndicator(
        progress = { (progress.positionMs.toFloat() / progress.durationMs).coerceIn(0f, 1f) },
        modifier = modifier.fillMaxWidth().height(4.dp),
        color = Color(0xFFFFBD00),
        trackColor = Color.White.copy(alpha = .22f),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MediaActionSheet(
    target: MediaActionTarget?,
    snapshot: ProfileSnapshot?,
    metadataCache: WatchMetadataCache? = null,
    onDismiss: () -> Unit,
    onPlay: (MediaActionTarget) -> Unit,
    onDetails: (MediaActionTarget) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
) {
    // Keep mutation work owned by the screen-level sheet call, even after the
    // active sheet is dismissed and its target is cleared.
    val scope = rememberCoroutineScope()
    val active = target ?: return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var removingHistory by remember(active.progress?.videoId) { mutableStateOf(false) }
    val saved = snapshot?.library.orEmpty().any { it.type == active.item.type && it.id == active.item.id }
    val progress = active.progress
    val queue = snapshot?.queue.orEmpty()
    val seriesVideos = active.videos.ifEmpty { metadataCache?.videosFor(active.item).orEmpty() }
    val resolvedVideo = active.video ?: progress?.let { savedProgress ->
        seriesVideos.firstOrNull { progressMatchesVideo(savedProgress, it) }
    }
    val queueItem = playbackQueueItem(active.item, resolvedVideo)
    val queueIndex = queueItem?.let { item -> queue.indexOfFirst { it.key == item.key } } ?: -1
    val watchProgress = progress?.takeIf { resolvedVideo == null || progressMatchesVideo(it, resolvedVideo) }
    val releasedVideos = seriesWatchVideos(seriesVideos)
    val releasedIds = releasedVideos.mapTo(mutableSetOf(), VideoItem::id)
    val today = Clock.System.now().toString().take(10)
    val canQueueActiveVideo = queueItem != null && (
        active.item.type != "series" ||
            resolvedVideo != null && seriesVideos.any { it.id == resolvedVideo.id } && canQueueEpisode(resolvedVideo, today)
        )
    val seriesProgress = snapshot?.progress.orEmpty().filter {
        it.mediaType == active.item.type && it.mediaId == active.item.id && it.videoId in releasedIds
    }
    val seriesComplete = releasedVideos.isNotEmpty() && releasedVideos.all { video ->
        seriesProgress.any { it.videoId == video.id && it.watched }
    }
    val seasonVideos = active.season?.let { seasonWatchVideos(seriesVideos, it) }.orEmpty()
    val seasonIds = seasonVideos.mapTo(mutableSetOf(), VideoItem::id)
    val seasonProgress = snapshot?.progress.orEmpty().filter {
        it.mediaType == active.item.type && it.mediaId == active.item.id && it.videoId in seasonIds
    }
    val seasonComplete = seasonVideos.isNotEmpty() && seasonVideos.all { video ->
        seasonProgress.any { it.videoId == video.id && it.watched }
    }
    val episodeSeasonVideos = if (active.context == MediaActionContext.Episode && active.video != null) {
        seasonWatchVideos(seriesVideos, active.video.season ?: 1)
    } else {
        emptyList()
    }
    val episodeSeasonIds = episodeSeasonVideos.mapTo(mutableSetOf(), VideoItem::id)
    val episodeSeasonProgress = snapshot?.progress.orEmpty().filter {
        it.mediaType == active.item.type && it.mediaId == active.item.id && it.videoId in episodeSeasonIds
    }
    val episodeSeasonComplete = episodeSeasonVideos.isNotEmpty() && episodeSeasonVideos.all { video ->
        episodeSeasonProgress.any { it.videoId == video.id && it.watched }
    }
    LaunchedEffect(active.item.type, active.item.id, active.context, metadataCache) {
        if (active.item.type == "series" && active.video == null) {
            metadataCache?.load(active.item)
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color(0xFF171719),
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp)) {
            Text(
                resolvedVideo?.title
                    ?: resolvedVideo?.name
                    ?: active.season?.let { if (it == 0) "Specials" else "Season $it" }
                    ?: progress?.videoTitle
                    ?: active.item.name,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (active.context != MediaActionContext.Browse && active.context != MediaActionContext.Season && active.canPlay) {
                ActionRow(if (watchProgress != null && watchProgress.positionMs > 0 && !watchProgress.watched) "Resume" else "Play", Icons.Rounded.PlayArrow) {
                    onDismiss(); onPlay(active)
                }
            }
            if (active.context != MediaActionContext.Episode && active.context != MediaActionContext.Season) {
                ActionRow("Details", Icons.Rounded.Info) { onDismiss(); onDetails(active) }
            }
            if (queueItem != null && (queueIndex >= 0 || canQueueActiveVideo)) {
                // Toasts fire before the mutation launches: dismissing this
                // sheet cancels its composition scope mid-network, and an emit
                // placed after the await would never run.
                fun addToQueueWithFeedback() {
                    val next = queue.addToQueue(queueItem)
                    val rank = next.indexOfFirst { it.key == queueItem.key } + 1
                    QueueToasts.emit(if (rank <= 1) "Up next" else "Added to queue · #$rank")
                    scope.launch { onMutation(ProfileMutation.SetQueue(next)) }
                }
                fun moveToFrontWithFeedback() {
                    QueueToasts.emit("Playing next")
                    scope.launch { onMutation(ProfileMutation.SetQueue(queue.moveToQueueFront(queueItem))) }
                }
                fun removeFromQueueWithFeedback() {
                    QueueToasts.emit("Removed from queue")
                    scope.launch { onMutation(ProfileMutation.SetQueue(queue.removeFromQueue(queueItem.key))) }
                }
                when {
                    queueIndex == 0 -> ActionRow("Remove from queue", Icons.Rounded.PlaylistRemove) {
                        onDismiss()
                        removeFromQueueWithFeedback()
                    }
                    queueIndex > 0 -> {
                        if (canQueueActiveVideo) {
                            ActionRow("Move to next", Icons.Rounded.VerticalAlignTop) {
                                onDismiss()
                                moveToFrontWithFeedback()
                            }
                        }
                        ActionRow("Remove from queue", Icons.Rounded.PlaylistRemove) {
                            onDismiss()
                            removeFromQueueWithFeedback()
                        }
                    }
                    queue.isNotEmpty() && canQueueActiveVideo -> {
                        ActionRow("Play next", Icons.Rounded.SkipNext) {
                            onDismiss()
                            moveToFrontWithFeedback()
                        }
                        ActionRow("Add to queue", Icons.Rounded.PlaylistAdd) {
                            onDismiss()
                            addToQueueWithFeedback()
                        }
                    }
                    canQueueActiveVideo -> ActionRow("Add to queue", Icons.Rounded.PlaylistAdd) {
                        onDismiss()
                        addToQueueWithFeedback()
                    }
                }
            }
            if (active.context == MediaActionContext.Season) {
                ActionRow(
                    if (seasonVideos.isEmpty()) "No released episodes available"
                    else if (seasonComplete) "Mark season unwatched"
                    else "Mark season watched",
                    if (seasonComplete) Icons.Rounded.Replay else Icons.Rounded.Check,
                    enabled = seasonVideos.isNotEmpty(),
                ) {
                    onDismiss()
                    scope.launch {
                        onMutation(
                            ProfileMutation.SetSeriesWatched(
                                active.item,
                                seasonVideos,
                                seasonProgress,
                                !seasonComplete,
                            ),
                        )
                    }
                }
            } else if (
                (active.context == MediaActionContext.Browse || active.context == MediaActionContext.Library) &&
                active.item.type == "series" && active.video == null
            ) {
                ActionRow(
                    if (releasedVideos.isEmpty()) "Loading series episodes…"
                    else if (seriesComplete) "Mark series unwatched"
                    else "Mark series watched",
                    if (seriesComplete) Icons.Rounded.Replay else Icons.Rounded.Check,
                    enabled = releasedVideos.isNotEmpty(),
                ) {
                    onDismiss()
                    scope.launch {
                        onMutation(
                            ProfileMutation.SetSeriesWatched(
                                active.item,
                                releasedVideos,
                                seriesProgress,
                                !seriesComplete,
                            ),
                        )
                    }
                }
            } else if (
                watchProgress != null || active.item.type == "movie" || active.context == MediaActionContext.Episode ||
                (active.video != null && active.canPlay)
            ) {
                ActionRow(
                    if (watchProgress?.watched == true) "Mark unwatched" else "Mark watched",
                    if (watchProgress?.watched == true) Icons.Rounded.Replay else Icons.Rounded.Check,
                ) {
                    onDismiss()
                    scope.launch { onMutation(ProfileMutation.SetWatched(active.item, watchProgress, active.video, watchProgress?.watched != true)) }
                }
            }
            if (active.context == MediaActionContext.Episode && episodeSeasonVideos.isNotEmpty()) {
                ActionRow(
                    if (episodeSeasonComplete) "Mark season unwatched" else "Mark season watched",
                    if (episodeSeasonComplete) Icons.Rounded.Replay else Icons.Rounded.Check,
                ) {
                    onDismiss()
                    scope.launch {
                        onMutation(
                            ProfileMutation.SetSeriesWatched(
                                active.item,
                                episodeSeasonVideos,
                                episodeSeasonProgress,
                                !episodeSeasonComplete,
                            ),
                        )
                    }
                }
            }
            if (active.context == MediaActionContext.Continue && progress != null) {
                ActionRow("Remove from Continue Watching", Icons.Rounded.VisibilityOff) {
                    onDismiss(); scope.launch { onMutation(ProfileMutation.SetDismissed(progress, true)) }
                }
            }
            if (active.context != MediaActionContext.Episode && active.context != MediaActionContext.Continue) {
                ActionRow(if (saved) "Remove from library" else "Add to library", if (saved) Icons.Rounded.BookmarkRemove else Icons.Rounded.BookmarkAdd, destructive = saved) {
                    onDismiss(); scope.launch { onMutation(ProfileMutation.SetLibrary(active.item, !saved)) }
                }
            }
            if (active.context == MediaActionContext.History && progress != null) {
                ActionRow("Remove from history", Icons.Rounded.DeleteOutline, destructive = true) { removingHistory = true }
            }
        }
    }
    if (removingHistory && progress != null) {
        AlertDialog(
            onDismissRequest = { removingHistory = false },
            title = { Text("Remove from history?") },
            text = { Text("This removes ${active.item.name} from this profile’s watch history.") },
            dismissButton = { TextButton(onClick = { removingHistory = false }) { Text("Cancel") } },
            confirmButton = {
                TextButton(onClick = {
                    removingHistory = false
                    onDismiss()
                    scope.launch { onMutation(ProfileMutation.RemoveProgress(progress)) }
                }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ActionRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, destructive: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(label, color = if (!enabled) MaterialTheme.colorScheme.onSurfaceVariant else if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) },
        leadingContent = { Icon(icon, null, tint = if (!enabled) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f) else if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).combinedClickable(enabled = enabled, onClick = onClick),
    )
}
