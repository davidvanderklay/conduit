package media.conduit.mobile

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
import kotlinx.coroutines.launch
import media.conduit.mobile.account.*

internal enum class MediaActionContext { Browse, Library, Continue, History, Episode }

internal data class MediaActionTarget(
    val item: CatalogItem,
    val context: MediaActionContext,
    val progress: ProgressSummary? = null,
    val video: VideoItem? = null,
    val canPlay: Boolean = true,
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
                runCatching { api.loadMeta(addons, item.type, item.id) }
                    .onSuccess { metadata[key] = it }
            }
        } finally {
            loading.remove(key)
        }
    }

    fun metadataFor(item: CatalogItem): MetaItem? = metadata["${item.type}:${item.id}"]

    fun videosFor(item: CatalogItem): List<VideoItem> = metadataFor(item)?.videos.orEmpty()
}

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
    onClick: () -> Unit,
    onActions: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val presentation = continueWatchingPresentation(progress, metadata?.videos.orEmpty())
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
    val badge = if (!metadataReady && progress.mediaType == "series" && progress.watched) {
        null
    } else when (presentation.kind) {
        ContinueWatchingKind.InProgress -> remainingTimeLabel(progress)
        ContinueWatchingKind.NewEpisode -> "New Episode"
        ContinueWatchingKind.Scheduled -> presentation.label
        ContinueWatchingKind.CaughtUp -> "Caught up"
    }
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
                    ContinueWatchingKind.InProgress -> "Resume ${progress.name}"
                    ContinueWatchingKind.NewEpisode -> "Play the new episode of ${progress.name}"
                    ContinueWatchingKind.Scheduled -> "View ${progress.name}, next episode ${presentation.label}"
                    ContinueWatchingKind.CaughtUp -> "View ${progress.name}, caught up"
                },
                onLongClickLabel = "More actions for ${progress.name}",
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
            contentDescription = progress.name,
            contentScale = artwork?.second ?: ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
            onError = { artworkIndex += 1 },
        )
        if (artwork == null) {
            Text(
                progress.name.take(1),
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
        badge?.let { label ->
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
                    label,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
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
                progress.name,
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
    Column(
        modifier.scale(cardScale).combinedClickable(
            interactionSource = interaction,
            indication = null,
            onClickLabel = "Open ${item.name}",
            onLongClickLabel = "More actions for ${item.name}",
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
                contentDescription = item.name,
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
                item.name,
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
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val cardScale by animateFloatAsState(if (pressed) .98f else 1f, label = "progress-card-press")
    val haptics = LocalHapticFeedback.current
    Column(
        modifier.scale(cardScale).combinedClickable(
            interactionSource = interaction,
            indication = null,
            onClickLabel = "Resume ${progress.name}",
            onLongClickLabel = "More actions for ${progress.name}",
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
            AsyncImage(progress.poster, progress.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            if (progress.poster == null) {
                Text(progress.name.take(1), modifier = Modifier.align(Alignment.Center), style = MaterialTheme.typography.displayMedium, color = Color.White.copy(alpha = .24f))
            }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .45f)))))
            ProgressRail(progress, Modifier.align(Alignment.BottomCenter))
        }
        Text(progress.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
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
    onDetails: (CatalogItem) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
) {
    // Keep mutation work owned by the screen-level sheet call, even after the
    // active sheet is dismissed and its target is cleared.
    val scope = rememberCoroutineScope()
    val active = target ?: return
    var removingHistory by remember(active.progress?.videoId) { mutableStateOf(false) }
    val saved = snapshot?.library.orEmpty().any { it.type == active.item.type && it.id == active.item.id }
    val progress = active.progress
    val watchProgress = progress?.takeIf { active.video == null || active.video.id == it.videoId }
    val seriesVideos = metadataCache?.videosFor(active.item).orEmpty()
    val releasedIds = completionEpisodeIds(seriesVideos).toSet()
    val releasedVideos = seriesVideos.filter { it.id in releasedIds }
    val seriesProgress = snapshot?.progress.orEmpty().filter {
        it.mediaType == active.item.type && it.mediaId == active.item.id && it.videoId in releasedIds
    }
    val seriesComplete = releasedVideos.isNotEmpty() && releasedVideos.all { video ->
        seriesProgress.any { it.videoId == video.id && it.watched }
    }
    LaunchedEffect(active.item.type, active.item.id, active.context, metadataCache) {
        if (active.item.type == "series" && active.video == null && active.context == MediaActionContext.Browse) {
            metadataCache?.load(active.item)
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Color(0xFF171719)) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp)) {
            Text(
                active.video?.title ?: progress?.videoTitle ?: active.item.name,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (active.context != MediaActionContext.Browse && active.canPlay) {
                ActionRow(if (watchProgress != null && watchProgress.positionMs > 0 && !watchProgress.watched) "Resume" else "Play", Icons.Rounded.PlayArrow) {
                    onDismiss(); onPlay(active)
                }
            }
            if (active.context != MediaActionContext.Episode) {
                ActionRow("Details", Icons.Rounded.Info) { onDismiss(); onDetails(active.item) }
            }
            if (active.context == MediaActionContext.Browse && active.item.type == "series" && active.video == null) {
                ActionRow(
                    if (releasedVideos.isEmpty()) "Loading released episodes…"
                    else if (seriesComplete) "Mark released episodes unwatched"
                    else "Mark released episodes watched",
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
                    if (watchProgress?.watched == true) "Mark unwatched" else if (active.item.type == "series") "Mark episode watched" else "Mark watched",
                    if (watchProgress?.watched == true) Icons.Rounded.Replay else Icons.Rounded.Check,
                ) {
                    onDismiss()
                    scope.launch { onMutation(ProfileMutation.SetWatched(active.item, watchProgress, active.video, watchProgress?.watched != true)) }
                }
            }
            if (active.context == MediaActionContext.Continue && progress != null) {
                ActionRow("Dismiss", Icons.Rounded.VisibilityOff) {
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
