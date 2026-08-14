package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import media.conduit.mobile.account.*

internal class HomeScreenCache {
    val result = mutableStateOf<HomeCatalogResult?>(null)
    val loading = mutableStateOf(false)
    val catalogError = mutableStateOf<String?>(null)
}

@Composable
internal fun HomeScreen(
    sync: ProfileSyncState,
    api: ConduitApi,
    onSelect: (CatalogItem, String?) -> Unit,
    onSelectContinueWatching: (CatalogItem, String?) -> Unit,
    onSelectContinueWatchingDetails: (CatalogItem) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    onOpenContinueWatching: () -> Unit,
    onOpenDiscover: (DiscoverSelection) -> Unit,
    listState: LazyListState = rememberLazyListState(),
    cache: HomeScreenCache = remember { HomeScreenCache() },
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var result by cache.result
    var loading by cache.loading
    var catalogError by cache.catalogError
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(api, sync.snapshot?.addons.orEmpty())

    fun load() {
        val addons = sync.snapshot?.addons ?: return
        loading = true
        catalogError = null
        scope.launch {
            runCatching { api.loadHomeCatalogs(addons) }
                .onSuccess { result = it }
                .onFailure { catalogError = it.message ?: "Unable to load catalogs" }
            loading = false
        }
    }
    LaunchedEffect(sync.snapshot?.profileId, sync.snapshot?.addons) { load() }

    val continueWatching = groupContinueWatching(sync.snapshot?.continueWatching.orEmpty())
    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize().statusBarsPadding(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 82.dp, bottom = 112.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        if (sync.offline) {
            item { StatusPill("Offline · showing saved activity", MaterialTheme.colorScheme.tertiary) }
        }
        if (continueWatching.isNotEmpty()) {
            item { ShelfTitle("Continue Watching", onOpenContinueWatching) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(continueWatching, key = { it.videoId }) { item ->
                        val catalogItem = CatalogItem(item.mediaId, item.mediaType, item.name, poster = item.poster)
                        LaunchedEffect(catalogItem.type, catalogItem.id) {
                            metadataCache.load(catalogItem, includeMovies = true)
                        }
                        val metadata = metadataCache.metadataFor(catalogItem)
                        val watchedVideoIds = sync.snapshot?.progress.orEmpty()
                            .filter { it.mediaType == item.mediaType && it.mediaId == item.mediaId && it.watched }
                            .mapTo(mutableSetOf(), ProgressSummary::videoId)
                        val presentation = continueWatchingPresentation(
                            progress = item,
                            videos = metadata?.videos.orEmpty(),
                            watchedVideoIds = watchedVideoIds,
                        )
                        val displayItem = catalogItem.copy(
                            poster = metadata?.poster ?: catalogItem.poster,
                            background = metadata?.background,
                        )
                        val targetVideoId = when (presentation.kind) {
                            ContinueWatchingKind.InProgress -> item.videoId
                            ContinueWatchingKind.NewEpisode, ContinueWatchingKind.NextUp -> presentation.video?.id
                            ContinueWatchingKind.Scheduled, ContinueWatchingKind.CaughtUp -> null
                        }
                        ContinueWatchingCard(
                            progress = item,
                            item = displayItem,
                            metadata = metadata,
                            metadataReady = item.mediaType != "series" || metadata != null,
                            watchedVideoIds = watchedVideoIds,
                            onClick = { onSelectContinueWatching(displayItem, targetVideoId) },
                            onActions = {
                                actionTarget = MediaActionTarget(
                                    displayItem,
                                    MediaActionContext.Continue,
                                    item,
                                    presentation.video,
                                    presentation.kind == ContinueWatchingKind.InProgress ||
                                        presentation.kind == ContinueWatchingKind.NewEpisode ||
                                        presentation.kind == ContinueWatchingKind.NextUp,
                                )
                            },
                            modifier = Modifier.width(220.dp),
                        )
                    }
                }
            }
        }
        if (loading && result == null) {
            item { CatalogSkeleton() }
        }
        catalogError?.let { message ->
            item {
                ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
                        TextButton(onClick = ::load) { Text("Try again") }
                    }
                }
            }
        }
        result?.takeIf { it.failedRequests > 0 }?.let { catalogs ->
            item { StatusPill("${catalogs.failedRequests} catalog requests failed", MaterialTheme.colorScheme.error) }
        }
        result?.catalogs.orEmpty().filter { it.items.isNotEmpty() }.forEach { catalog ->
            item(key = "${catalog.key}:title") {
                ShelfTitle(catalog.title) {
                    onOpenDiscover(
                        DiscoverSelection(
                            addonId = catalog.addonId,
                            type = catalog.type,
                            catalogId = catalog.catalogId,
                        ),
                    )
                }
            }
            item(key = catalog.key) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
                        RichPosterCard(
                            item, item.releaseInfo ?: item.type, sync.snapshot, metadataCache,
                            onClick = { onSelect(item, null) },
                            onActions = { actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(sync.snapshot, item)) },
                            modifier = Modifier.width(112.dp),
                        )
                    }
                }
            }
        }
        if (!loading && sync.snapshot != null && continueWatching.isEmpty() &&
            result?.catalogs.orEmpty().all { it.items.isEmpty() }
        ) {
            item {
                ElevatedCard {
                    Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Your home is ready", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "Install or enable an add-on with catalogs to begin browsing.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = sync.snapshot,
        metadataCache = metadataCache,
        onDismiss = { actionTarget = null },
        onPlay = { target ->
            val select = if (target.context == MediaActionContext.Continue) onSelectContinueWatching else onSelect
            select(target.item, target.video?.id ?: target.progress?.videoId)
        },
        onDetails = { target ->
            if (target.context == MediaActionContext.Continue) {
                onSelectContinueWatchingDetails(target.item)
            } else {
                onSelect(target.item, null)
            }
        },
        onMutation = onMutation,
    )
}

@Composable
private fun ShelfTitle(title: String, onSeeAll: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        TextButton(onClick = onSeeAll, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
            Text("See all", style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun StatusPill(text: String, color: Color) {
    Surface(color = color.copy(alpha = .14f), shape = RoundedCornerShape(100.dp)) {
        Text(text, color = color, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun CatalogSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.width(180.dp).height(24.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            repeat(3) { Box(Modifier.width(132.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) }
        }
    }
}
