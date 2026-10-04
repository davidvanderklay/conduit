@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package media.conduit.mobile.tv

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import media.conduit.mobile.ContinueWatchingCard
import media.conduit.mobile.ContinueWatchingKind
import media.conduit.mobile.MediaActionContext
import media.conduit.mobile.MediaActionSheet
import media.conduit.mobile.MediaActionTarget
import media.conduit.mobile.RichPosterCard
import media.conduit.mobile.TvShellModel
import media.conduit.mobile.WatchMetadataCache
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.MetaItem
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.mediaTypeLabel
import media.conduit.mobile.continueWatchingPresentation
import media.conduit.mobile.focusRing
import media.conduit.mobile.latestProgress
import media.conduit.mobile.progressDisplayTitle
import media.conduit.mobile.progressTitleUiKey
import media.conduit.mobile.rememberVisibleContinueWatching
import media.conduit.mobile.rememberWatchMetadataCache

/** What the hero area above the rows describes: always the focused tile. */
internal data class TvHeroItem(val item: CatalogItem, val eyebrow: String? = null)

@Composable
internal fun TvHome(model: TvShellModel, memory: TvFocusMemory, active: Boolean) {
    val sync = model.sync
    val cache = model.homeCache
    val scope = rememberCoroutineScope()
    var result by cache.result
    var loading by cache.loading
    var catalogError by cache.catalogError
    val metadataCache = rememberWatchMetadataCache(model.api, sync.snapshot?.addons.orEmpty())
    var hero by remember(sync.snapshot?.profileId) { mutableStateOf<TvHeroItem?>(null) }
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val listState = rememberLazyListState()
    val firstTile = remember { FocusRequester() }
    val tileSpec = LocalBringIntoViewSpec.current
    val rowLead = with(LocalDensity.current) { 34.dp.toPx() }
    val rowPivot = remember(rowLead) {
        object : BringIntoViewSpec {
            override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float) = offset - rowLead
        }
    }

    fun load() {
        val addons = sync.snapshot?.addons ?: return
        loading = true
        catalogError = null
        scope.launch {
            runCatching { model.api.loadHomeCatalogs(addons) }
                .onSuccess { result = it }
                .onFailure { catalogError = it.message ?: "Unable to load catalogs" }
            loading = false
        }
    }
    LaunchedEffect(sync.snapshot?.profileId, sync.snapshot?.addons) { load() }

    val continueWatching = rememberVisibleContinueWatching(sync.snapshot, metadataCache, active, sync.offline)
    val catalogs = result?.catalogs.orEmpty().filter { it.items.isNotEmpty() }
    val hasRows = continueWatching.isNotEmpty() || catalogs.isNotEmpty()
    LaunchedEffect(hasRows) {
        if (hasRows && memory.key == null) firstTile.requestFocusWhenReady()
    }
    // Enrich the hero after focus settles so fast scrolling does not fan out requests.
    LaunchedEffect(hero?.item?.id) {
        val focused = hero?.item ?: return@LaunchedEffect
        delay(350)
        metadataCache.load(focused, includeMovies = true)
    }

    Box(Modifier.fillMaxSize()) {
        TvBackdrop(hero?.item?.let { metadataCache.metadataFor(it)?.background ?: it.background ?: it.poster })
        Column(Modifier.fillMaxSize().padding(start = TvSpacing.Rail + 14.dp)) {
            TvHero(hero, hero?.item?.let(metadataCache::metadataFor), Modifier.height(206.dp).padding(top = TvSpacing.Edge))
            // The focused row always scrolls to the top of the list, under the hero.
            CompositionLocalProvider(LocalBringIntoViewSpec provides rowPivot) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 220.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                var rowIndex = 0
                if (continueWatching.isNotEmpty()) {
                    val index = rowIndex++
                    item(key = "continue") {
                        TvRow("Continue Watching", tileSpec) {
                            items(continueWatching, key = ::progressTitleUiKey) { progress ->
                                TvContinueCard(
                                    progress = progress,
                                    model = model,
                                    metadataCache = metadataCache,
                                    onActions = { actionTarget = it },
                                    modifier = Modifier
                                        .then(if (index == 0 && progress == continueWatching.first()) Modifier.focusRequester(firstTile) else Modifier)
                                        .tvRememberFocus(memory, "continue:${progressTitleUiKey(progress)}"),
                                    onFocused = { hero = it },
                                )
                            }
                        }
                    }
                }
                if (sync.offline) {
                    rowIndex++
                    item(key = "offline") { Text("Offline. Showing saved activity.", color = TvColors.AmberSoft, style = MaterialTheme.typography.bodyMedium) }
                }
                catalogError?.let { message ->
                    rowIndex++
                    item(key = "error") {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Text(message, color = MaterialTheme.colorScheme.error)
                            TvButton("Try again", onClick = ::load)
                        }
                    }
                }
                catalogs.forEach { catalog ->
                    val index = rowIndex++
                    val firstRow = index == 0
                    item(key = catalog.key) {
                        TvRow(catalog.title, tileSpec) {
                            items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
                                val key = "${catalog.key}:${item.type}:${item.id}"
                                RichPosterCard(
                                    item, item.releaseInfo ?: item.type, sync.snapshot, metadataCache,
                                    onClick = { model.onOpenMedia(item, null) },
                                    onActions = {
                                        actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(sync.snapshot, item))
                                    },
                                    modifier = Modifier
                                        .width(104.dp)
                                        .then(if (firstRow && item == catalog.items.first()) Modifier.focusRequester(firstTile) else Modifier)
                                        .tvTile(
                                            memory,
                                            key,
                                            onMenu = {
                                                actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(sync.snapshot, item))
                                            },
                                            onFocused = { hero = TvHeroItem(item) },
                                        ),
                                    showLabels = false,
                                )
                            }
                        }
                    }
                }
                if (!loading && sync.snapshot != null && !hasRows && catalogError == null) {
                    item(key = "empty") {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Your home is ready", color = Color.White, style = MaterialTheme.typography.titleLarge)
                            Text("Install or enable an add-on with catalogs in Settings to begin browsing.", color = TvColors.Muted)
                        }
                    }
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
        onPlay = { target -> model.onResume(target.item, target.video?.id ?: target.progress?.videoId) },
        onDetails = { target ->
            if (target.context == MediaActionContext.Continue) model.onOpenResumeDetails(target.item)
            else model.onOpenMedia(target.item, null)
        },
        onMutation = model.onMutation,
    )
}

@Composable
private fun TvContinueCard(
    progress: ProgressSummary,
    model: TvShellModel,
    metadataCache: WatchMetadataCache,
    onActions: (MediaActionTarget) -> Unit,
    onFocused: (TvHeroItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = model.sync.snapshot
    val catalogItem = CatalogItem(progress.mediaId, progress.mediaType, progress.name, poster = progress.poster)
    LaunchedEffect(catalogItem.type, catalogItem.id, model.sync.offline) {
        metadataCache.load(catalogItem, includeMovies = true)
    }
    val metadata = metadataCache.metadataFor(catalogItem)
    val watchedVideoIds = snapshot?.progress.orEmpty()
        .filter { it.mediaType == progress.mediaType && it.mediaId == progress.mediaId && it.watched }
        .mapTo(mutableSetOf(), ProgressSummary::videoId)
    val presentation = continueWatchingPresentation(progress, metadata?.videos.orEmpty(), watchedVideoIds = watchedVideoIds)
    val displayItem = catalogItem.copy(
        name = progressDisplayTitle(progress, metadata?.name),
        poster = metadata?.poster ?: catalogItem.poster,
        background = metadata?.background,
    )
    val playable = presentation.kind == ContinueWatchingKind.InProgress ||
        presentation.kind == ContinueWatchingKind.NewEpisode ||
        presentation.kind == ContinueWatchingKind.NextUp
    val targetVideoId = when (presentation.kind) {
        ContinueWatchingKind.InProgress -> progress.videoId
        ContinueWatchingKind.NewEpisode, ContinueWatchingKind.NextUp -> presentation.video?.id
        else -> null
    }
    val season = presentation.video?.season ?: progress.season
    val episode = presentation.video?.episode ?: progress.episode
    ContinueWatchingCard(
        progress = progress,
        item = displayItem,
        metadata = metadata,
        metadataReady = progress.mediaType != "series" || metadata != null,
        watchedVideoIds = watchedVideoIds,
        onClick = { model.onResume(displayItem, targetVideoId) },
        onActions = { onActions(MediaActionTarget(displayItem, MediaActionContext.Continue, progress, presentation.video, playable)) },
        modifier = modifier.width(168.dp).tvMenuKey {
            onActions(MediaActionTarget(displayItem, MediaActionContext.Continue, progress, presentation.video, playable))
        }.focusRing(RoundedCornerShape(14.dp)) {
            onFocused(
                TvHeroItem(
                    displayItem,
                    eyebrow = if (season != null && episode != null) "Continue · S$season E$episode" else "Continue",
                ),
            )
        },
    )
}

@Composable
internal fun TvRow(
    title: String,
    tileSpec: BringIntoViewSpec,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        // Tiles keep the platform's horizontal pivot; only the row list pins to the top.
        CompositionLocalProvider(LocalBringIntoViewSpec provides tileSpec) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(end = TvSpacing.Edge),
                content = content,
            )
        }
    }
}

/** Full-bleed artwork behind a screen, darkened toward the text side and the rows below. */
@Composable
internal fun TvBackdrop(artwork: String?) {
    val background = MaterialTheme.colorScheme.background
    Box(Modifier.fillMaxSize()) {
        Crossfade(artwork, animationSpec = tween(320), label = "tv-backdrop") { url ->
            if (url != null) {
                AsyncImage(url, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
            }
        }
        Box(
            Modifier.fillMaxSize().background(
                Brush.horizontalGradient(
                    0f to background.copy(alpha = .96f),
                    .42f to background.copy(alpha = .62f),
                    1f to background.copy(alpha = .08f),
                ),
            ),
        )
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to background.copy(alpha = .22f),
                    .40f to background.copy(alpha = .10f),
                    .80f to background.copy(alpha = .92f),
                    1f to background,
                ),
            ),
        )
    }
}

@Composable
private fun TvHero(hero: TvHeroItem?, meta: MetaItem?, modifier: Modifier = Modifier) {
    Column(modifier.widthIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        val item = hero?.item ?: return@Column
        hero.eyebrow?.let { TvSectionLabel(it, color = TvColors.AmberSoft) }
        val logo = meta?.logo?.takeIf(String::isNotBlank)
        if (logo != null) {
            AsyncImage(
                logo,
                meta.name,
                Modifier.heightIn(max = 62.dp).widthIn(max = 280.dp),
                contentScale = ContentScale.Fit,
                alignment = Alignment.CenterStart,
            )
        } else {
            Text(
                meta?.name ?: item.name,
                color = Color.White,
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        TvFacts(
            listOfNotNull(
                mediaTypeLabel(item.type),
                meta?.genres?.firstOrNull(),
                meta?.releaseInfo ?: item.releaseInfo,
                meta?.runtime,
            ),
            imdbRating = meta?.imdbRating,
        )
        (meta?.description ?: item.description)?.trim()?.takeIf(String::isNotBlank)?.let {
            Text(it, color = Color(0xFFD4D4D8), style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A dot-separated metadata line with the amber IMDb badge the desktop app uses. */
@Composable
internal fun TvFacts(facts: List<String>, imdbRating: String?, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val visible = facts.map(String::trim).filter(String::isNotBlank)
        if (visible.isNotEmpty()) {
            Text(visible.joinToString("  ·  "), color = Color(0xFFE4E4E7), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1)
        }
        imdbRating?.trim()?.takeIf(String::isNotBlank)?.let { rating ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    "IMDb",
                    color = TvColors.OnAmber,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.background(TvColors.Amber, RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 1.dp),
                )
                Text(rating, color = Color.White, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            }
        }
    }
}
