package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import kotlinx.coroutines.CancellationException
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
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
    homeRows: List<HomeRowSetting>,
    onSelect: (CatalogItem, String?) -> Unit,
    onSelectContinueWatching: (CatalogItem, String?) -> Unit,
    onSelectContinueWatchingDetails: (CatalogItem) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    onOpenContinueWatching: () -> Unit,
    onOpenDiscover: (DiscoverSelection) -> Unit,
    listState: LazyListState = rememberLazyListState(),
    cache: HomeScreenCache = remember { HomeScreenCache() },
    modifier: Modifier = Modifier,
    active: Boolean = true,
) {
    var result by cache.result
    var loading by cache.loading
    var catalogError by cache.catalogError
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(api, sync.snapshot?.addons.orEmpty())

    var reloads by remember { mutableIntStateOf(0) }
    // A key change cancels the previous load, so an older, slower load never replaces newer rows.
    LaunchedEffect(sync.snapshot?.profileId, sync.snapshot?.addons, homeRows, reloads) {
        val addons = sync.snapshot?.addons ?: return@LaunchedEffect
        loading = true
        catalogError = null
        try {
            result = api.loadHomeCatalogs(addons, homeRows)
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            catalogError = cause.message ?: "Unable to load catalogs"
        }
        loading = false
    }

    val continueWatching = rememberVisibleContinueWatching(sync.snapshot, metadataCache, active, sync.offline)
    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize().statusBarsPadding(),
        contentPadding = PaddingValues(top = 72.dp, bottom = 112.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        if (sync.offline) {
            item { StatusPill("Offline · showing saved activity", MaterialTheme.colorScheme.tertiary, Modifier.padding(horizontal = PageGutter)) }
        }
        if (continueWatching.isNotEmpty()) {
            item {
                Shelf("Continue Watching", onOpenContinueWatching) {
                    LazyRow(contentPadding = PaddingValues(horizontal = PageGutter), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(continueWatching, key = ::progressTitleUiKey) { item ->
                            val catalogItem = CatalogItem(item.mediaId, item.mediaType, item.name, poster = item.poster)
                            LaunchedEffect(catalogItem.type, catalogItem.id, sync.offline) {
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
                                name = progressDisplayTitle(item, metadata?.name),
                                poster = metadata?.poster ?: catalogItem.poster,
                                background = metadata?.background,
                            )
                            val targetVideoId = when (presentation.kind) {
                                ContinueWatchingKind.InProgress -> item.videoId
                                ContinueWatchingKind.NewEpisode, ContinueWatchingKind.NextUp -> presentation.video?.id
                                ContinueWatchingKind.Scheduled, ContinueWatchingKind.CaughtUp, ContinueWatchingKind.Completed -> null
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
        }
        if (loading && result == null) {
            item { CatalogSkeleton() }
        }
        catalogError?.let { message ->
            item {
                ElevatedCard(modifier = Modifier.padding(horizontal = PageGutter), colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
                        TextButton(onClick = { reloads++ }) { Text("Try again") }
                    }
                }
            }
        }
        result?.takeIf { it.failedRequests > 0 }?.let { catalogs ->
            item { StatusPill("${catalogs.failedRequests} catalog requests failed", MaterialTheme.colorScheme.error, Modifier.padding(horizontal = PageGutter)) }
        }
        val visibleCatalogs = result?.catalogs.orEmpty().filter { it.items.isNotEmpty() }
        visibleCatalogs.forEachIndexed { index, catalog ->
            // Without a Continue Watching row, the first shelf becomes large backdrop cards so Home has one focal row.
            val featured = index == 0 && continueWatching.isEmpty()
            item(key = catalog.key) {
                Shelf(
                    catalog.title,
                    onSeeAll = {
                        onOpenDiscover(
                            DiscoverSelection(
                                addonId = catalog.addonId,
                                type = catalog.type,
                                catalogId = catalog.catalogId,
                            ),
                        )
                    },
                ) {
                    LazyRow(contentPadding = PaddingValues(horizontal = PageGutter), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (featured) items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
                            FeatureCard(
                                item,
                                onClick = { onSelect(item, null) },
                                onActions = { actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(sync.snapshot, item)) },
                                modifier = Modifier.fillParentMaxWidth(.86f),
                            )
                        } else items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
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
        }
        if (!loading && sync.snapshot != null && continueWatching.isEmpty() &&
            result?.catalogs.orEmpty().all { it.items.isEmpty() }
        ) {
            item {
                ElevatedCard(Modifier.padding(horizontal = PageGutter)) {
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
            onSelect(target.item, target.video?.id ?: target.progress?.videoId)
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

/**
 * A titled row of posters, shared by Home and search. The title sits close to its row so each shelf
 * reads as one unit; [source] adds quiet attribution and [onSeeAll] a compact link.
 */
@Composable
internal fun Shelf(title: String, onSeeAll: (() -> Unit)? = null, source: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).padding(start = PageGutter, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.Bottom) {
                Text(
                    title,
                    style = ShelfTitleStyle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                source?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp, bottom = 2.dp))
                }
            }
            // A compact text link keeps the row as tall as its title; the padding still gives a usable target.
            if (onSeeAll != null) Text(
                "See all",
                style = MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = "See all $title", onClick = onSeeAll).padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
        content()
    }
}

@Composable
private fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(color = color.copy(alpha = .14f), shape = RoundedCornerShape(100.dp), modifier = modifier) {
        Text(text, color = color, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun CatalogSkeleton() {
    Column(Modifier.padding(horizontal = PageGutter), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.width(180.dp).height(22.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainer))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            repeat(4) { Box(Modifier.width(112.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) }
        }
    }
}

/** Landscape backdrop card for the featured Home row: artwork, title logo (or name), and year. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun FeatureCard(item: CatalogItem, onClick: () -> Unit, onActions: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .combinedClickable(
                    onClickLabel = "Open ${item.name}",
                    onLongClickLabel = "More actions for ${item.name}",
                    onClick = onClick,
                    onLongClick = {
                        haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                        onActions()
                    },
                ),
        ) {
            coil3.compose.AsyncImage(
                model = item.background ?: item.poster,
                contentDescription = item.name,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, .5f to Color.Transparent, 1f to Color.Black.copy(alpha = .55f))))
            // Title logo and year sit together on the art, so the card needs no caption underneath.
            Column(Modifier.align(Alignment.BottomStart).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!item.logo.isNullOrBlank()) {
                    var logoAnalysis by remember(item.logo) { mutableStateOf<LogoAnalysis?>(null) }
                    coil3.compose.AsyncImage(
                        model = item.logo,
                        contentDescription = null,
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        colorFilter = if (logoAnalysis?.dark == true) androidx.compose.ui.graphics.ColorFilter.tint(Color.White) else null,
                        onSuccess = { logoAnalysis = runCatching { it.analyzeLogo() }.getOrNull() },
                        alignment = Alignment.BottomStart,
                        modifier = Modifier.trimLogoInsets(logoAnalysis).fillMaxWidth(.55f).heightIn(max = 44.dp),
                    )
                } else {
                    Text(item.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                item.releaseInfo?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp), color = Color.White.copy(alpha = .7f)) }
            }
        }
    }
}
