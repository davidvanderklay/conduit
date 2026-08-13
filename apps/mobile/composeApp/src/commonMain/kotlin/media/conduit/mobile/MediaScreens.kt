package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Velocity
import coil3.compose.AsyncImage
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.booleanOrNull
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.*
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val VideoItem.displayTitle: String
    get() = title?.takeIf(String::isNotBlank)
        ?: name?.takeIf(String::isNotBlank)
        ?: overview?.lineSequence()?.firstOrNull()?.take(80)?.takeIf(String::isNotBlank)
        ?: "Episode ${episode ?: ""}".trim()

@Composable
internal fun MobileLibraryScreen(
    snapshot: ProfileSnapshot?,
    api: ConduitApi,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    onOpenCalendar: () -> Unit,
    onSelect: (CatalogItem) -> Unit,
    onSelectVideo: (CatalogItem, String?) -> Unit,
    gridState: androidx.compose.foundation.lazy.grid.LazyGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState(),
    modifier: Modifier = Modifier,
) {
    var filter by remember { mutableStateOf("all") }
    var sort by remember { mutableStateOf(LibrarySort.LastWatched) }
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(api, snapshot?.addons.orEmpty())
    val filteredItems = snapshot?.library.orEmpty().filter { filter == "all" || it.type == filter }
    val statusSort = sort == LibrarySort.Watched || sort == LibrarySort.NotWatched
    val statusKey = if (statusSort) {
        filteredItems.joinToString(prefix = sort.name, separator = "|") { "${it.type}:${it.id}:${it.updatedAt}" }
    } else {
        null
    }
    var preparedStatusKey by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(statusKey, metadataCache) {
        if (statusKey == null) {
            preparedStatusKey = null
            return@LaunchedEffect
        }
        coroutineScope {
            filteredItems.forEach { item -> launch { metadataCache.load(item.asCatalogItem()) } }
        }
        preparedStatusKey = statusKey
    }
    val loadingStatus = statusKey != null && preparedStatusKey != statusKey
    val items = orderLibraryItems(filteredItems, snapshot?.progress.orEmpty(), sort) { item ->
        completionEpisodeIds(metadataCache.videosFor(item.asCatalogItem()))
    }

    Column(modifier.statusBarsPadding()) {
        Spacer(Modifier.height(68.dp))
        Column(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Library", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                IconButton(onClick = onOpenCalendar) {
                    Icon(Icons.Rounded.CalendarMonth, "Open release calendar")
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CompactFilterMenu(
                    value = when (filter) { "movie" -> "Movies"; "series" -> "Series"; else -> "All types" },
                    options = listOf("all" to "All types", "movie" to "Movies", "series" to "Series"),
                    selectedKey = filter,
                    onSelect = { filter = it },
                    modifier = Modifier.weight(.9f),
                )
                CompactFilterMenu(
                    value = sort.label,
                    options = LibrarySort.entries.map { it.name to it.label },
                    selectedKey = sort.name,
                    onSelect = { selected -> LibrarySort.entries.firstOrNull { it.name == selected }?.let { sort = it } },
                    modifier = Modifier.weight(1.35f),
                )
            }
        }
        if (snapshot == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (loadingStatus) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text("Nothing saved here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyVerticalGrid(
                state = gridState,
                columns = GridCells.Fixed(3),
                contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 112.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(items, key = { "${it.type}:${it.id}" }) { item ->
                    val catalogItem = item.asCatalogItem()
                    RichPosterCard(
                        item = catalogItem,
                        caption = item.type,
                        snapshot = snapshot,
                        metadataCache = metadataCache,
                        onClick = { onSelectVideo(catalogItem, latestProgress(snapshot, catalogItem)?.videoId) },
                        onActions = { actionTarget = MediaActionTarget(catalogItem, MediaActionContext.Library, latestProgress(snapshot, catalogItem)) },
                    )
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = snapshot,
        onDismiss = { actionTarget = null },
        onPlay = { onSelectVideo(it.item, it.progress?.videoId) },
        onDetails = onSelect,
        onMutation = onMutation,
    )
}

@Composable
internal fun MobileHistoryScreen(
    snapshot: ProfileSnapshot?,
    api: ConduitApi,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    onBack: () -> Unit,
    onSelect: (CatalogItem) -> Unit,
    onSelectVideo: (CatalogItem, String?) -> Unit,
    gridState: androidx.compose.foundation.lazy.grid.LazyGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState(),
    modifier: Modifier = Modifier,
) {
    var filter by remember { mutableStateOf("all") }
    var sort by remember { mutableStateOf(LibrarySort.LastWatched) }
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(api, snapshot?.addons.orEmpty())
    val items = snapshot?.history.orEmpty()
        .groupBy { "${it.mediaType}:${it.mediaId}" }
        .values
        .mapNotNull { entries -> entries.maxByOrNull(ProgressSummary::updatedAt) }
        .filter { filter == "all" || it.mediaType == filter }
        .let { entries ->
            when (sort) {
                LibrarySort.LastWatched -> entries.sortedWith(
                    compareByDescending<ProgressSummary>(ProgressSummary::updatedAt)
                        .thenBy { it.name.lowercase() }
                        .thenBy(ProgressSummary::mediaId),
                )
                LibrarySort.Name -> entries.sortedWith(
                    compareBy<ProgressSummary> { it.name.lowercase() }
                        .thenBy(ProgressSummary::mediaId),
                )
                LibrarySort.NameDescending -> entries.sortedWith(
                    compareByDescending<ProgressSummary> { it.name.lowercase() }
                        .thenBy(ProgressSummary::mediaId),
                )
                LibrarySort.Watched,
                LibrarySort.NotWatched,
                -> entries
            }
        }

    PlatformBackHandler(onBack = onBack)
    Column(modifier.fillMaxSize()) {
        ProfileHeader("Watch history", onBack)
        Column(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Everything you have viewed", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CompactFilterMenu(
                    value = when (filter) { "movie" -> "Movies"; "series" -> "Series"; else -> "All types" },
                    options = listOf("all" to "All types", "movie" to "Movies", "series" to "Series"),
                    selectedKey = filter,
                    onSelect = { filter = it },
                    modifier = Modifier.weight(.9f),
                )
                CompactFilterMenu(
                    value = sort.label,
                    options = listOf(LibrarySort.LastWatched, LibrarySort.Name, LibrarySort.NameDescending)
                        .map { it.name to it.label },
                    selectedKey = sort.name,
                    onSelect = { selected ->
                        listOf(LibrarySort.LastWatched, LibrarySort.Name, LibrarySort.NameDescending)
                            .firstOrNull { it.name == selected }
                            ?.let { sort = it }
                    },
                    modifier = Modifier.weight(1.35f),
                )
            }
        }
        if (snapshot == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text("No watch history yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyVerticalGrid(
                state = gridState,
                columns = GridCells.Fixed(3),
                contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 112.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(items, key = { "${it.mediaType}:${it.mediaId}" }) { progress ->
                    val catalogItem = CatalogItem(progress.mediaId, progress.mediaType, progress.name, poster = progress.poster)
                    RichPosterCard(
                        item = catalogItem,
                        caption = progress.videoTitle ?: progress.mediaType,
                        snapshot = snapshot,
                        metadataCache = metadataCache,
                        onClick = { onSelectVideo(catalogItem, progress.videoId) },
                        onActions = { actionTarget = MediaActionTarget(catalogItem, MediaActionContext.History, progress) },
                    )
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = snapshot,
        onDismiss = { actionTarget = null },
        onPlay = { onSelectVideo(it.item, it.progress?.videoId) },
        onDetails = onSelect,
        onMutation = onMutation,
    )
}

internal data class DiscoverSelection(
    val addonId: String? = null,
    val type: String? = null,
    val catalogId: String? = null,
    val genre: String? = null,
)

internal sealed interface MobileBrowseTarget {
    data class Discover(val selection: DiscoverSelection) : MobileBrowseTarget
    data class Search(val query: String) : MobileBrowseTarget
}

@Composable
internal fun SearchDiscoverScreen(
    addons: List<InstalledAddonSummary>,
    api: ConduitApi,
    snapshot: ProfileSnapshot?,
    query: String,
    onQueryChange: (String) -> Unit,
    selection: DiscoverSelection,
    onSelectionChange: (DiscoverSelection) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    onSelect: (CatalogItem, String?) -> Unit,
    listState: androidx.compose.foundation.lazy.LazyListState = rememberLazyListState(),
    gridState: androidx.compose.foundation.lazy.grid.LazyGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState(),
    modifier: Modifier = Modifier,
) {
    val catalogs = remember(addons) { discoverCatalogs(addons) }
    val types = remember(catalogs) { catalogs.map(DiscoverCatalog::type).distinct() }
    val type = selection.type?.takeIf(types::contains) ?: types.firstOrNull().orEmpty()
    val typeCatalogs = remember(catalogs, type) { catalogs.filter { it.type == type } }
    val explicitlySelected = typeCatalogs.firstOrNull {
        it.addonId == selection.addonId && it.id == selection.catalogId
    }
    val genreSelected = selection.genre?.let { requestedGenre ->
        typeCatalogs.firstOrNull { it.supportsGenre && (it.genres.isEmpty() || requestedGenre in it.genres) }
    }
    val selected = explicitlySelected ?: genreSelected ?: typeCatalogs.firstOrNull()
    val genre = selection.genre?.takeIf {
        selected?.supportsGenre == true && (selected.genres.isEmpty() || it in selected.genres)
    }
        ?: selected?.genres?.firstOrNull()?.takeIf { selected.genreRequired }
    val normalizedSelection = DiscoverSelection(selected?.addonId, type, selected?.id, genre)
    var results by remember(addons) { mutableStateOf<List<HomeCatalog>>(emptyList()) }
    var searchLoading by remember { mutableStateOf(false) }
    var discoverItems by remember { mutableStateOf<List<CatalogItem>>(emptyList()) }
    var discoverLoading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var discoverError by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(api, addons)
    val windowWidth = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
    LaunchedEffect(normalizedSelection) {
        if (selection != normalizedSelection) onSelectionChange(normalizedSelection)
    }
    LaunchedEffect(query, addons) {
        if (query.isBlank()) { results = emptyList(); searchLoading = false; return@LaunchedEffect }
        delay(350)
        searchLoading = true
        results = runCatching { api.searchCatalogs(addons, query.trim()) }.getOrDefault(emptyList())
        searchLoading = false
    }
    LaunchedEffect(selected, genre) {
        discoverItems = emptyList()
        discoverError = null
        hasMore = true
        loadingMore = false
        if (selected == null) return@LaunchedEffect
        discoverLoading = true
        runCatching { api.loadCatalog(selected, genre) }
            .onSuccess { page -> discoverItems = page.distinctBy { "${it.type}:${it.id}" }; hasMore = page.isNotEmpty() }
            .onFailure { discoverError = it.message ?: "Unable to load this catalog"; hasMore = false }
        discoverLoading = false
        gridState.scrollToItem(0)
    }

    Column(modifier.fillMaxSize().statusBarsPadding()) {
        Spacer(Modifier.height(68.dp))
        if (query.isBlank()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                CompactFilterMenu(
                    value = typeLabel(type),
                    options = types.map { it to typeLabel(it) },
                    onSelect = { onSelectionChange(DiscoverSelection(type = it)) },
                    modifier = Modifier.weight(.85f),
                )
                CompactFilterMenu(
                    value = selected?.name ?: "Content",
                    options = typeCatalogs.map { catalog ->
                        "${catalog.addonId}:${catalog.id}" to if (typeCatalogs.count { it.name == catalog.name } > 1) {
                            "${catalog.name} · ${catalog.addonName}"
                        } else catalog.name
                    },
                    onSelect = { key ->
                        val next = typeCatalogs.firstOrNull { "${it.addonId}:${it.id}" == key } ?: return@CompactFilterMenu
                        onSelectionChange(DiscoverSelection(next.addonId, type, next.id))
                    },
                    modifier = Modifier.weight(1.15f),
                )
                CompactFilterMenu(
                    value = genre ?: "All genres",
                    options = buildList {
                        if (selected?.genreRequired != true) add("" to "All genres")
                        selected?.genres.orEmpty().forEach { add(it to it) }
                    },
                    enabled = selected?.genres?.isNotEmpty() == true,
                    onSelect = { onSelectionChange(normalizedSelection.copy(genre = it.ifBlank { null })) },
                    modifier = Modifier.weight(1.05f),
                )
            }
            when {
                discoverLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                selected == null -> EmptyBrowseState("No discover catalogs available.")
                discoverError != null -> EmptyBrowseState(discoverError!!)
                discoverItems.isEmpty() -> EmptyBrowseState("This catalog returned no titles.")
                else -> LazyVerticalGrid(
                    state = gridState,
                    columns = if (windowWidth >= 600.dp) GridCells.Adaptive(150.dp) else GridCells.Fixed(2),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 112.dp),
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    items(discoverItems, key = { "${it.type}:${it.id}" }) { item ->
                        RichPosterCard(
                            item = item,
                            caption = item.releaseInfo ?: typeLabel(item.type),
                            snapshot = snapshot,
                            metadataCache = metadataCache,
                            onClick = { onSelect(item, null) },
                            onActions = { actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(snapshot, item)) },
                            showLabels = false,
                        )
                    }
                    if (hasMore) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            LaunchedEffect(discoverItems.size, selected, genre) {
                                if (loadingMore) return@LaunchedEffect
                                val catalog = selected
                                loadingMore = true
                                runCatching { api.loadCatalog(catalog, genre, discoverItems.size) }
                                    .onSuccess { page ->
                                        val known = discoverItems.mapTo(mutableSetOf()) { "${it.type}:${it.id}" }
                                        val next = page.filter { known.add("${it.type}:${it.id}") }
                                        discoverItems = discoverItems + next
                                        hasMore = page.isNotEmpty() && next.isNotEmpty()
                                    }
                                    .onFailure { hasMore = false }
                                loadingMore = false
                            }
                            Box(Modifier.fillMaxWidth().height(64.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp)) }
                        }
                    }
                }
            }
        } else {
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(top = 8.dp, bottom = 112.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                if (searchLoading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (!searchLoading && results.isEmpty()) item { EmptyBrowseState("No results for “$query”.") }
                results.forEach { catalog ->
                    item(key = "search-heading-${catalog.key}-$query") {
                        Text(catalog.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 10.dp))
                    }
                    item(key = "search-rail-${catalog.key}-$query") {
                        LazyRow(contentPadding = PaddingValues(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                            items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
                                RichPosterCard(
                                    item = item, caption = item.releaseInfo ?: item.type,
                                    snapshot = snapshot, metadataCache = metadataCache,
                                    onClick = { onSelect(item, null) },
                                    onActions = { actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(snapshot, item)) },
                                    modifier = Modifier.width(132.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget, snapshot = snapshot, onDismiss = { actionTarget = null },
        metadataCache = metadataCache,
        onPlay = { onSelect(it.item, null) }, onDetails = { onSelect(it, null) }, onMutation = onMutation,
    )
}

@Composable
private fun RowScope.CompactFilterMenu(
    value: String,
    options: List<Pair<String, String>>,
    selectedKey: String? = null,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    Box(modifier) {
        Surface(
            modifier = Modifier.fillMaxWidth().clickable(enabled && options.isNotEmpty()) {
                focusManager.clearFocus()
                expanded = true
            },
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .78f),
        ) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(value, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                Icon(Icons.Rounded.KeyboardArrowDown, null, Modifier.size(18.dp))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (key, label) ->
                DropdownMenuItem(
                    text = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = { expanded = false; onSelect(key) },
                    trailingIcon = if (key == selectedKey) {{ Icon(Icons.Rounded.Check, null, Modifier.size(18.dp)) }} else null,
                )
            }
        }
    }
}

@Composable
private fun EmptyBrowseState(message: String) {
    Box(Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) {
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun typeLabel(type: String): String = when (type.lowercase()) {
    "movie" -> "Movie"
    "series" -> "Series"
    else -> type.replaceFirstChar(Char::uppercase)
}

private class HeroOverscrollConnection(
    private val atTop: () -> Boolean,
    private val maxPullPx: Float,
    private val pull: MutableFloatState,
    private val pullResistance: Float = HeroMotion.pullResistance,
) : NestedScrollConnection {
    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (available.y >= 0f || pull.floatValue <= 0f) return Offset.Zero
        val consumed = min(-available.y, pull.floatValue)
        pull.floatValue -= consumed
        return Offset(0f, -consumed)
    }

    override fun onPostScroll(
        consumed: Offset,
        available: Offset,
        source: NestedScrollSource,
    ): Offset {
        if (source != NestedScrollSource.UserInput || available.y <= 0f || !atTop()) return Offset.Zero
        val pullDelta = min(available.y * pullResistance, maxPullPx - pull.floatValue)
        if (pullDelta <= 0f) return Offset(0f, available.y)
        pull.floatValue += pullDelta
        return Offset(0f, available.y)
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
        val start = pull.floatValue
        if (start > 0f) {
            animate(
                initialValue = start,
                targetValue = 0f,
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
            ) { value, _ -> pull.floatValue = value }
        }
        return Velocity.Zero
    }
}

private object HeroMotion {
    val maxPull = 128.dp
    const val pullResistance = .42f
    const val expansionScale = .22f
    const val upwardTranslation = .12f
}

@Composable
private fun MetadataCreditLinks(
    label: String,
    values: List<String>,
    onBrowse: (MobileBrowseTarget) -> Unit,
) {
    val visibleValues = values.map(String::trim).filter(String::isNotBlank).distinct()
    if (visibleValues.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            label.uppercase(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall,
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            items(visibleValues) { value ->
                SuggestionChip(
                    onClick = { onBrowse(MobileBrowseTarget.Search(value)) },
                    label = { Text(value, maxLines = 1) },
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun MediaDetailsScreen(
    item: CatalogItem,
    initialVideoId: String?,
    addons: List<InstalledAddonSummary>,
    api: ConduitApi,
    profile: ProfileSummary?,
    snapshot: ProfileSnapshot?,
    baseUrl: String,
    token: String,
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    onProgressChanged: (ProgressSummary?) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    onBrowse: (MobileBrowseTarget) -> Unit,
    onBack: () -> Unit,
    playbackSession: PlaybackSessionController,
) {
    var meta by remember(item.id, item.type) { mutableStateOf<MetaItem?>(null) }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    var selectedVideo by remember(item.id) { mutableStateOf<VideoItem?>(null) }
    var streams by remember(item.id) { mutableStateOf<List<StreamSource>?>(null) }
    var streamPageOpen by remember(item.id) { mutableStateOf(false) }
    var streamsLoading by remember(item.id) { mutableStateOf(false) }
    var streamsError by remember(item.id) { mutableStateOf<String?>(null) }
    var selectedStreamAddonId by remember(item.id) { mutableStateOf(preferences.lastStreamAddonId) }
    var playing by remember(item.id) { mutableStateOf<StreamItem?>(null) }
    var resumePosition by remember(item.id) { mutableStateOf(0L) }
    var currentAddonId by remember(item.id) { mutableStateOf<String?>(null) }
    var episodesOpen by remember(item.id) { mutableStateOf(false) }
    var currentAddonName by remember(item.id) { mutableStateOf<String?>(null) }
    var externalSubtitles by remember(item.id) { mutableStateOf<List<SubtitleItem>>(emptyList()) }
    var externalSubtitlesLoaded by remember(item.id) { mutableStateOf(false) }
    var selectedSeason by remember(item.id) { mutableStateOf<Int?>(null) }
    var autoResumeAttemptedKey by remember(item.id) { mutableStateOf<String?>(null) }
    var selectedPlaybackSources by remember(item.id) { mutableStateOf<Map<String, PlaybackSource>>(emptyMap()) }
    var streamRequestVersion by remember(item.id) { mutableIntStateOf(0) }
    val effectiveInitialVideoId = effectiveResumeVideoId(
        initialVideoId,
        snapshot?.progress.orEmpty(),
        item,
    )
    val detailsListState = rememberLazyListState()
    val heroPull = remember { mutableFloatStateOf(0f) }
    val maxHeroPullPx = with(LocalDensity.current) { HeroMotion.maxPull.toPx() }
    val heroPullConnection = remember(detailsListState, maxHeroPullPx) {
        HeroOverscrollConnection(
            atTop = {
                detailsListState.firstVisibleItemIndex == 0 &&
                    detailsListState.firstVisibleItemScrollOffset == 0
            },
            maxPullPx = maxHeroPullPx,
            pull = heroPull,
        )
    }
    val detailsSeasonListState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    var actionTarget by remember(item.id) { mutableStateOf<MediaActionTarget?>(null) }
    LaunchedEffect(item.id, item.type, addons) {
        runCatching { api.loadMeta(addons, item.type, item.id) }
            .onSuccess {
                meta = it
                selectedVideo = it.videos.firstOrNull { video -> video.id == effectiveInitialVideoId }
                    ?: it.videos.firstOrNull()
            }.onFailure { error = it.message }
    }
    suspend fun loadStreamsWithRetry(
        videoId: String,
        requestedAddons: List<InstalledAddonSummary>,
    ): Result<List<StreamSource>> {
        var result = Result.failure<List<StreamSource>>(IllegalStateException("Unable to load streams"))
        repeat(3) { attempt ->
            result = runCatching { api.loadStreams(requestedAddons, item.type, videoId) }
            if (result.isSuccess && result.getOrThrow().isNotEmpty()) return result
            if (attempt < 2) delay(400L * (attempt + 1))
        }
        return result
    }
    fun savedPlaybackSourceFor(videoId: String): PlaybackSource? =
        selectedPlaybackSources[videoId]
            ?: snapshot?.progress?.firstOrNull { it.videoId == videoId }?.playbackSource

    val addonSignature = addons.joinToString("|") { "${it.id}:${it.enabled}:${it.manifestUrl}" }
    fun autoResumeAttemptKey(source: PlaybackSource): String =
        "$addonSignature:${source.addonId}:${source.sourceKey}:${preferences.autoSelectSavedStreams}"

    fun requestStreams(
        video: VideoItem? = selectedVideo,
        autoPlaySavedSource: Boolean = false,
        addonId: String? = selectedStreamAddonId,
    ) {
        if (!autoPlaySavedSource) streamPageOpen = true
        streamsLoading = true
        streamsError = null
        val videoId = video?.id ?: item.id
        val requestVersion = ++streamRequestVersion
        streams = null
        scope.launch {
            val compatibleAddons = addons.filter { it.enabled && it.supportsResource("stream", item.type, videoId) }
            val effectiveAddonId = addonId?.takeIf { selectedId ->
                compatibleAddons.size > 1 && compatibleAddons.any { it.id == selectedId }
            }
            val requestedAddons = effectiveAddonId?.let { selectedId -> compatibleAddons.filter { it.id == selectedId } }
                ?: compatibleAddons
            val result = loadStreamsWithRetry(videoId, requestedAddons)
            if (requestVersion != streamRequestVersion) return@launch
            result
                .onSuccess { choices ->
                    streams = choices
                    if (autoPlaySavedSource) {
                        val saved = savedPlaybackSourceFor(videoId)
                        val choice = selectSavedStream(choices, saved)
                        if (choice != null) {
                            currentAddonId = choice.addonId
                            currentAddonName = choice.addonName
                            val selectedSource = playbackSourceForStream(choice.addonId, choice.stream)
                            selectedPlaybackSources = selectedPlaybackSources + (videoId to selectedSource)
                            if (autoPlaySavedSource) autoResumeAttemptedKey = autoResumeAttemptKey(selectedSource)
                            playing = choice.stream
                        } else {
                            streamsError = if (choices.isEmpty()) {
                                "No streams were returned. Try again."
                            } else {
                                "Saved source unavailable. Choose another source below."
                            }
                            streamPageOpen = true
                        }
                    }
                }
                .onFailure {
                    streamsError = it.message ?: "Unable to load streams"
                    if (autoPlaySavedSource) streamPageOpen = true
                }
            streamsLoading = false
        }
    }
    val playingVideoId = selectedVideo?.id ?: item.id
    val streamAddonChoices = remember(addons, item.type, playingVideoId) {
        addons
            .filter { it.enabled && it.supportsResource("stream", item.type, playingVideoId) }
            .map { addon ->
                StreamAddonChoice(
                    id = addon.id,
                    name = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId,
                )
            }
    }
    LaunchedEffect(playingVideoId, streamAddonChoices) {
        if (selectedStreamAddonId == null || streamAddonChoices.none { it.id == selectedStreamAddonId }) {
            selectedStreamAddonId = preferences.lastStreamAddonId?.takeIf { rememberedId ->
                streamAddonChoices.any { it.id == rememberedId }
            }
        }
    }
    LaunchedEffect(playingVideoId, addons) {
        externalSubtitlesLoaded = false
        externalSubtitles = runCatching { api.loadSubtitles(addons, item.type, playingVideoId) }.getOrDefault(emptyList())
        externalSubtitlesLoaded = true
    }
    LaunchedEffect(playingVideoId, profile?.id) {
        resumePosition = snapshot?.progress?.firstOrNull { it.videoId == playingVideoId }?.takeUnless { it.watched }?.positionMs
            ?: profile?.let { runCatching { api.loadProgress(baseUrl, token, it.id, playingVideoId) }.getOrNull()?.takeUnless { progress -> progress.watched }?.positionMs }
            ?: 0L
    }
    val savedPlaybackSource = effectiveInitialVideoId?.let { videoId ->
        snapshot?.progress?.firstOrNull { it.videoId == videoId }?.playbackSource
    }
    val currentAutoResumeAttemptKey = savedPlaybackSource?.let(::autoResumeAttemptKey)
    LaunchedEffect(meta?.id, selectedVideo?.id, effectiveInitialVideoId, savedPlaybackSource, addonSignature, preferences.autoSelectSavedStreams) {
        if (effectiveInitialVideoId == null || meta == null || addons.isEmpty()) return@LaunchedEffect
        val targetVideoId = selectedVideo?.id ?: item.id
        if (targetVideoId != effectiveInitialVideoId) return@LaunchedEffect
        val saved = savedPlaybackSource ?: return@LaunchedEffect
        if (currentAutoResumeAttemptKey == null || autoResumeAttemptedKey == currentAutoResumeAttemptKey) return@LaunchedEffect
        autoResumeAttemptedKey = currentAutoResumeAttemptKey
        requestStreams(selectedVideo, autoPlaySavedSource = preferences.autoSelectSavedStreams)
    }
    val waitingForSavedPlayback = preferences.autoSelectSavedStreams &&
        effectiveInitialVideoId != null && savedPlaybackSource != null &&
        error == null && (meta == null || addons.isNotEmpty()) &&
        !streamPageOpen && playing == null &&
        (autoResumeAttemptedKey == null || streamsLoading)
    fun currentPlaybackSource(): PlaybackSource? =
        currentAddonId?.let { addonId -> playing?.let { playbackSourceForStream(addonId, it) } }
    val orderedVideos = meta?.videos.orEmpty().sortedWith(compareBy<VideoItem> { it.season ?: 0 }.thenBy { it.episode ?: 0 })
    val nextVideo = orderedVideos.indexOfFirst { it.id == selectedVideo?.id }.takeIf { it >= 0 }?.let { orderedVideos.getOrNull(it + 1) }
    val playerContentTitle = if (selectedVideo != null) {
        val episodeNumber = listOfNotNull(selectedVideo?.season, selectedVideo?.episode)
            .takeIf { it.size == 2 }
            ?.joinToString("x")
        listOfNotNull(
            selectedVideo?.displayTitle,
            episodeNumber?.let { "($it)" },
        ).joinToString(" - ")
    } else {
        meta?.name ?: item.name
    }
    val activeProfile = profile
    val selectedStream = playing
    val requestIdentity = activeProfile?.let {
        PlaybackIdentity(it.id, item.type, item.id, selectedVideo?.id ?: item.id)
    }
    val sessionCallbacks = requestIdentity?.let { identity ->
        PlaybackSessionCallbacks(
            persist = { request, state ->
                val existing = snapshot?.progress?.firstOrNull { it.videoId == request.identity.videoId }
                resolveProgressState(state, existing)?.let { resolved ->
                    val saved = api.saveProgress(
                        baseUrl, token, request.identity.profileId, request.identity.videoId,
                        request.identity.mediaType, request.identity.mediaId, request.mediaName,
                        request.poster, request.episodeTitle, request.season, request.episode,
                        resolved.positionMs, resolved.durationMs, request.source, resolved.watched,
                    )
                    onProgressChanged(saved)
                }
            },
            playNext = {
                nextVideo?.let { video ->
                    playbackSession.close(saveProgress = false)
                    playing = null
                    selectedVideo = video
                    resumePosition = 0L
                    requestStreams(video)
                }
            },
            openEpisodes = {
                episodesOpen = true
                playbackSession.minimize(notifyOwner = false)
            },
            minimized = onBack,
            closed = { playing = null },
        )
    }
    LaunchedEffect(
        selectedStream?.url,
        requestIdentity,
        externalSubtitlesLoaded,
        externalSubtitles,
        playerContentTitle,
        nextVideo?.id,
    ) {
        val streamUrl = selectedStream?.url ?: return@LaunchedEffect
        if (!externalSubtitlesLoaded) return@LaunchedEffect
        val identity = requestIdentity ?: return@LaunchedEffect
        val callbacks = sessionCallbacks ?: return@LaunchedEffect
        val request = PlaybackRequest(
            identity = identity,
            url = streamUrl,
            requestHeaders = selectedStream.behaviorHints?.proxyHeaders?.request.orEmpty()
                .mapNotNull { (key, value) -> value.jsonPrimitive.contentOrNull?.let { key to it } }
                .toMap(),
            subtitles = externalSubtitles,
            title = playerContentTitle,
            mediaName = if (selectedVideo != null) {
                "${meta?.name ?: item.name}  ·  ${selectedVideo?.displayTitle}"
            } else {
                meta?.name ?: item.name
            },
            artwork = meta?.background ?: item.background ?: meta?.poster ?: item.poster,
            logo = meta?.logo,
            poster = meta?.poster ?: item.poster,
            episodeTitle = selectedVideo?.displayTitle,
            season = selectedVideo?.season,
            episode = selectedVideo?.episode,
            startPositionMs = resumePosition,
            source = currentPlaybackSource(),
            hasNextEpisode = nextVideo != null,
            nextEpisodeTitle = nextVideo?.let { "S${it.season ?: 0}E${it.episode ?: 0} · ${it.displayTitle}" },
            nextEpisodeArtwork = nextVideo?.thumbnail ?: meta?.background,
            hasEpisodes = orderedVideos.isNotEmpty(),
        )
        playbackSession.start(request, callbacks)
    }
    SideEffect {
        if (requestIdentity != null && sessionCallbacks != null) playbackSession.attach(requestIdentity, sessionCallbacks)
    }
    val ownsPlayback = requestIdentity != null && playbackSession.state.request?.identity == requestIdentity
    PlayerOrientationLock(
        active = waitingForSavedPlayback ||
            (playing != null && !ownsPlayback) ||
            (ownsPlayback && playbackSession.state.presentation == PlaybackPresentation.FullScreen),
    )
    PlatformBackHandler {
        when {
            ownsPlayback && playbackSession.state.presentation == PlaybackPresentation.FullScreen -> {
                playbackSession.leaveFullScreen(preferences.miniplayerOnBack)
            }
            streamPageOpen -> { streamPageOpen = false; streams = null }
            else -> onBack()
        }
    }
    if (episodesOpen) {
        Box(Modifier.fillMaxSize()) {
            PlayerEpisodeDrawer(
                orderedVideos,
                selectedVideo,
                snapshot,
                onDismiss = { episodesOpen = false },
            ) { video ->
                episodesOpen = false
                playbackSession.close()
                selectedVideo = video
                playing = null
                resumePosition = 0L
                requestStreams(video)
            }
        }
        return
    }
    if (waitingForSavedPlayback) {
        Box(Modifier.fillMaxSize()) {
            PlayerOpeningOverlay(
                artwork = meta?.background ?: item.background ?: meta?.poster ?: item.poster,
                logo = meta?.logo,
                title = meta?.name ?: item.name,
                modifier = Modifier.fillMaxSize(),
            )
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .padding(12.dp)
                    .background(Color.Black.copy(alpha = .58f), CircleShape),
            ) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White)
            }
        }
        return
    }
    if (streamPageOpen) {
        val closeStreamPage = {
            streamPageOpen = false
            streams = null
        }
        Box(Modifier.fillMaxSize()) {
            StreamSelectionScreen(
                title = meta?.name ?: item.name,
                artwork = meta?.background ?: meta?.poster ?: item.background ?: item.poster,
                episode = selectedVideo,
                streams = streams.orEmpty(),
                addonChoices = streamAddonChoices,
                selectedAddonId = selectedStreamAddonId,
                loading = streamsLoading,
                error = streamsError,
                onSelectAddon = { addonId ->
                    val currentEffective = effectiveStreamAddonId(selectedStreamAddonId, streamAddonChoices)
                    val nextEffective = effectiveStreamAddonId(addonId, streamAddonChoices)
                    selectedStreamAddonId = addonId
                    onPreferencesChanged(preferences.copy(lastStreamAddonId = addonId))
                    if (currentEffective != nextEffective) requestStreams(selectedVideo, addonId = addonId)
                },
                onRetry = { requestStreams(selectedVideo) },
            ) { source ->
                if (source.stream.url != null) {
                    currentAddonId = source.addonId
                    currentAddonName = source.addonName
                    val selectedSource = playbackSourceForStream(source.addonId, source.stream)
                    val videoId = selectedVideo?.id ?: item.id
                    selectedPlaybackSources = selectedPlaybackSources + (videoId to selectedSource)
                    if (videoId == effectiveInitialVideoId) autoResumeAttemptedKey = autoResumeAttemptKey(selectedSource)
                    playing = source.stream
                }
            }
            MobileBackButton(
                onClick = closeStreamPage,
                modifier = Modifier.align(Alignment.TopStart),
                background = MaterialTheme.colorScheme.background.copy(alpha = .96f),
                safeArea = true,
            )
        }
        return
    }

    val details = meta
    val actionItem = details?.asCatalogItem() ?: item
    val unfinishedProgress = latestUnfinishedProgress(snapshot?.progress.orEmpty(), actionItem)
    val resumeVideo = details?.videos?.firstOrNull { it.id == unfinishedProgress?.videoId }
    LaunchedEffect(details?.id, resumeVideo?.season) { if (selectedSeason == null) selectedSeason = resumeVideo?.season ?: details?.videos?.firstOrNull()?.season }
    val heroPullDp = with(LocalDensity.current) { heroPull.floatValue.toDp() }
    val heroScale = 1f + (heroPull.floatValue / maxHeroPullPx) * HeroMotion.expansionScale
    val heroHeight = if (item.type == "movie") 390.dp else 350.dp
    val titleLogo = details?.logo?.takeIf(String::isNotBlank)
    val detailHeaderCollapseOffset = with(LocalDensity.current) { (heroHeight - 72.dp).roundToPx() }
    val detailHeaderCollapsed by remember(detailsListState, detailHeaderCollapseOffset) {
        derivedStateOf {
            detailsListState.firstVisibleItemIndex > 0 ||
                detailsListState.firstVisibleItemScrollOffset >= detailHeaderCollapseOffset
        }
    }
    val saved = snapshot?.library.orEmpty().any { it.type == actionItem.type && it.id == actionItem.id }
    val imdbId = listOfNotNull(details?.id, item.id).firstOrNull { id ->
        id.length > 2 && id.startsWith("tt") && id.drop(2).all(Char::isDigit)
    }
    val metadataFacts = listOfNotNull(
        details?.runtime,
        details?.releaseInfo ?: details?.released?.take(4),
        details?.contentRating,
        details?.imdbRating,
    ).map(String::trim).filter(String::isNotBlank)
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = detailsListState,
            modifier = Modifier.fillMaxSize().nestedScroll(heroPullConnection),
            overscrollEffect = null,
            contentPadding = PaddingValues(bottom = 32.dp),
        ) {
        item {
            Box(Modifier.fillMaxWidth().height(heroHeight + 64.dp + heroPullDp)) {
                Box(Modifier.fillMaxWidth().height(heroHeight + heroPullDp).clipToBounds()) {
                    AsyncImage(
                        model = details?.background ?: item.background ?: details?.poster ?: item.poster,
                        contentDescription = item.name,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().graphicsLayer {
                            scaleX = heroScale
                            scaleY = heroScale
                            translationY = -heroPull.floatValue * HeroMotion.upwardTranslation
                        },
                    )
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(.15f), MaterialTheme.colorScheme.background))))
                }
                if (titleLogo != null) {
                    AsyncImage(
                        model = titleLogo,
                        contentDescription = details.name,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .offset(y = (-60).dp)
                            .fillMaxWidth(.58f)
                            .heightIn(max = 110.dp),
                    )
                } else {
                    Text(
                        details?.name ?: item.name,
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.BottomStart).padding(start = 20.dp, end = 20.dp, bottom = 36.dp).clickable {
                            onBrowse(MobileBrowseTarget.Search(details?.name ?: item.name))
                        },
                    )
                }
                Row(
                    modifier = Modifier.align(Alignment.BottomStart).padding(start = 20.dp, end = 20.dp, bottom = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    metadataFacts.takeIf { it.isNotEmpty() }?.let { facts ->
                        Text(
                            facts.joinToString("  ·  "),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (imdbId != null && details?.imdbRating?.isNotBlank() == true) {
                        Surface(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .clickable { uriHandler.openUri("https://www.imdb.com/title/$imdbId/") },
                            color = Color(0xFFF5C518),
                            contentColor = Color.Black,
                            shape = RoundedCornerShape(6.dp),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("IMDb", fontWeight = FontWeight.Black, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
        }
        item {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (details == null && error == null) CircularProgressIndicator()
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(onClick = { val target = resumeVideo ?: selectedVideo; selectedVideo = target; requestStreams(target) }, modifier = Modifier.fillMaxWidth().height(54.dp)) {
                    Icon(Icons.Rounded.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text(detailsPlayLabel(actionItem, unfinishedProgress, resumeVideo))
                }
                val movieProgress = snapshot?.progress.orEmpty().firstOrNull { it.videoId == actionItem.id }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = { scope.launch { onMutation(ProfileMutation.SetLibrary(actionItem, !saved, details?.runtime)) } },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = if (saved) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                            ),
                            border = BorderStroke(
                                1.dp,
                                if (saved) MaterialTheme.colorScheme.error.copy(alpha = .7f) else MaterialTheme.colorScheme.primary.copy(alpha = .7f),
                            ),
                        ) {
                            Icon(if (saved) Icons.Rounded.BookmarkRemove else Icons.Rounded.BookmarkAdd, null)
                            Spacer(Modifier.width(7.dp))
                            Text(if (saved) "Remove from library" else "Add to library")
                    }
                    if (actionItem.type == "movie") {
                        OutlinedButton(
                            onClick = { scope.launch { onMutation(ProfileMutation.SetWatched(actionItem, movieProgress, watched = movieProgress?.watched != true)) } },
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(if (movieProgress?.watched == true) Icons.Rounded.Replay else Icons.Rounded.Check, null)
                            Spacer(Modifier.width(7.dp))
                            Text(if (movieProgress?.watched == true) "Unwatch" else "Watched")
                        }
                    }
                }
                val trailerId = details?.trailerStreams?.firstNotNullOfOrNull {
                    it.youtubeId?.trim()?.takeIf(String::isNotBlank)
                } ?: details?.trailers?.firstNotNullOfOrNull {
                    it.source?.trim()?.takeIf(String::isNotBlank)
                }
                trailerId?.takeIf { id -> id.isNotEmpty() && id.all { it.isLetterOrDigit() || it == '-' || it == '_' } }?.let { id ->
                    OutlinedButton(
                        onClick = { uriHandler.openUri("https://www.youtube.com/watch?v=$id") },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.PlayCircleOutline, null)
                        Spacer(Modifier.width(7.dp))
                        Text("Trailer")
                    }
                }
                details?.genres
                    ?.map(String::trim)
                    ?.filter(String::isNotBlank)
                    ?.distinct()
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { genres ->
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        items(genres) { genre ->
                            AssistChip(
                                onClick = { onBrowse(MobileBrowseTarget.Discover(DiscoverSelection(type = details.type, genre = genre))) },
                                label = { Text(genre) },
                            )
                        }
                    }
                }
                details?.description?.trim()?.takeIf(String::isNotBlank)?.let {
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                }
                MetadataCreditLinks("Directors", details?.director.orEmpty(), onBrowse)
                MetadataCreditLinks("Cast", details?.cast.orEmpty(), onBrowse)
                MetadataCreditLinks("Writers", details?.writer.orEmpty(), onBrowse)
                details?.country?.let { MetadataCreditLinks("Country", listOf(it), onBrowse) }
                details?.awards?.trim()?.takeIf(String::isNotBlank)?.let {
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        details?.videos?.takeIf { it.isNotEmpty() }?.let { videos ->
            val seasons = videos.mapNotNull(VideoItem::season).distinct().sorted()
            item {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    LaunchedEffect(selectedSeason, seasons) { seasons.indexOf(selectedSeason).takeIf { it >= 0 }?.let { detailsSeasonListState.animateScrollToItem(it) } }
                    Text("Seasons", modifier = Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    LazyRow(state = detailsSeasonListState, contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { items(seasons) { season -> FilterChip(selected = selectedSeason == season, onClick = { selectedSeason = season }, label = { Text(if (season == 0) "Specials" else "Season $season") }) } }
                    Text(if (selectedSeason == 0) "Specials" else "Season ${selectedSeason ?: 1}", modifier = Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(videos.filter { it.season == selectedSeason }, key = VideoItem::id) { video ->
                            val progress = snapshot?.progress?.firstOrNull { it.videoId == video.id }
                            Surface(
                                modifier = Modifier.width(260.dp).combinedClickable(
                                    onClickLabel = "Play ${video.displayTitle}",
                                    onLongClickLabel = "More actions for ${video.displayTitle}",
                                    onClick = { selectedVideo = video; requestStreams(video) },
                                    onLongClick = {
                                        haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                                        actionTarget = MediaActionTarget(actionItem, MediaActionContext.Episode, progress, video)
                                    },
                                ),
                                shape = RoundedCornerShape(16.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(.65f),
                            ) {
                                Column { Box { AsyncImage(video.thumbnail ?: details.background, null, Modifier.fillMaxWidth().height(142.dp), contentScale = ContentScale.Crop); Surface(Modifier.padding(8.dp), color = Color.Black.copy(.65f), shape = RoundedCornerShape(8.dp)) { Text("S${video.season ?: 0}E${video.episode ?: 0}", color = Color.White, modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall) } }; Column(Modifier.padding(12.dp)) { Text(video.displayTitle, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); (video.overview ?: video.description)?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }; if (progress != null && progress.durationMs > 0) LinearProgressIndicator({ progress.positionMs.toFloat() / progress.durationMs }, Modifier.fillMaxWidth().padding(top = 8.dp), color = MaterialTheme.colorScheme.primary) } }
                            }
                        }
                    }
                }
            }
        }
        }
        if (detailHeaderCollapsed) {
            Surface(
                color = MaterialTheme.colorScheme.background.copy(alpha = .97f),
                shadowElevation = 8.dp,
                modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().statusBarsPadding().height(58.dp).padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back")
                    }
                    Box(Modifier.weight(1f).height(42.dp), contentAlignment = Alignment.Center) {
                        if (titleLogo != null) {
                            AsyncImage(
                                model = titleLogo,
                                contentDescription = details.name,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxWidth(.72f).heightIn(max = 38.dp),
                            )
                        } else {
                            Text(
                                details?.name ?: item.name,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    IconButton(onClick = {
                        scope.launch { onMutation(ProfileMutation.SetLibrary(actionItem, !saved, details?.runtime)) }
                    }) {
                        Icon(
                            if (saved) Icons.Rounded.BookmarkRemove else Icons.Rounded.BookmarkAdd,
                            if (saved) "Remove from library" else "Add to library",
                        )
                    }
                }
            }
        } else {
            MobileBackButton(
                onClick = onBack,
                modifier = Modifier.align(Alignment.TopStart),
                background = Color.Black.copy(alpha = .5f),
                tint = Color.White,
                safeArea = true,
            )
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = snapshot,
        onDismiss = { actionTarget = null },
        onPlay = { target ->
            selectedVideo = target.video
            requestStreams(target.video)
        },
        onDetails = {},
        onMutation = onMutation,
    )
}

@Composable
internal fun PlayerOpeningOverlay(artwork: String?, logo: String?, title: String, modifier: Modifier = Modifier) {
    val pulse = rememberInfiniteTransition(label = "player-opening")
    val indicatorScale by pulse.animateFloat(
        initialValue = .96f,
        targetValue = 1.04f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_250, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "opening-scale",
    )
    val indicatorAlpha by pulse.animateFloat(
        initialValue = .72f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_250, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "opening-alpha",
    )
    Box(modifier.background(Color.Black)) {
        artwork?.let { AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .64f)))
        val indicator = logo?.takeIf(String::isNotBlank) ?: artwork
        if (indicator != null) {
            AsyncImage(
                model = indicator,
                contentDescription = title,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth(.28f)
                    .heightIn(max = 100.dp)
                    .graphicsLayer {
                        scaleX = indicatorScale
                        scaleY = indicatorScale
                        alpha = indicatorAlpha
                    },
            )
        } else {
            Text(
                title,
                color = Color.White,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .align(Alignment.Center)
                    .graphicsLayer {
                        scaleX = indicatorScale
                        scaleY = indicatorScale
                        alpha = indicatorAlpha
                    },
            )
        }
    }
}

@Composable
internal fun PlayerBufferingOverlay(modifier: Modifier = Modifier) {
    Box(modifier.background(Color.Black.copy(alpha = .55f)), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            modifier = Modifier.size(32.dp),
            color = Color.White,
            trackColor = Color.White.copy(.24f),
            strokeWidth = 3.dp,
        )
    }
}

@Composable
private fun BoxScope.PlayerEpisodeDrawer(videos: List<VideoItem>, current: VideoItem?, snapshot: ProfileSnapshot?, onDismiss: () -> Unit, onSelect: (VideoItem) -> Unit) {
    var season by remember(current?.id, videos) { mutableStateOf(current?.season ?: videos.firstOrNull()?.season ?: 1) }
    val seasons = videos.mapNotNull(VideoItem::season).distinct().sorted()
    val seasonListState = rememberLazyListState()
    LaunchedEffect(season, seasons) { seasons.indexOf(season).takeIf { it >= 0 }?.let { seasonListState.animateScrollToItem(it) } }
    Box(Modifier.matchParentSize().background(Color.Black.copy(.32f)).clickable(onClick = onDismiss))
    var dragDistance by remember { mutableFloatStateOf(0f) }
    Surface(Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(.52f).pointerInput(Unit) { detectHorizontalDragGestures(onDragEnd = { if (dragDistance > 100f) onDismiss(); dragDistance = 0f }, onDragCancel = { dragDistance = 0f }) { change, amount -> change.consume(); dragDistance += amount } }, color = Color(0xF21A1A1D), shape = RoundedCornerShape(topStart = 28.dp, bottomStart = 28.dp), shadowElevation = 20.dp) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Episodes", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Spacer(Modifier.weight(1f)); IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) } }
            LazyRow(state = seasonListState, horizontalArrangement = Arrangement.spacedBy(8.dp)) { items(seasons) { value -> FilterChip(selected = season == value, onClick = { season = value }, label = { Text(if (value == 0) "Specials" else "Season $value") }) } }
            Spacer(Modifier.height(10.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(videos.filter { it.season == season }, key = VideoItem::id) { video ->
                    val progress = snapshot?.progress?.firstOrNull { it.videoId == video.id }
                    Surface(onClick = { onSelect(video) }, color = if (video.id == current?.id) MaterialTheme.colorScheme.primary.copy(.14f) else Color.White.copy(.05f), shape = RoundedCornerShape(16.dp), border = if (video.id == current?.id) BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null) {
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box { AsyncImage(video.thumbnail, null, Modifier.size(120.dp, 68.dp).clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.Crop); if (progress?.watched == true) Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)) }
                            Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)) { Text("${video.episode ?: ""}. ${video.displayTitle}", color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); (video.overview ?: video.description)?.let { Text(it, color = Color.White.copy(.55f), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }; if (progress != null && !progress.watched && progress.durationMs > 0) LinearProgressIndicator({ progress.positionMs.toFloat() / progress.durationMs }, Modifier.fillMaxWidth().padding(top = 7.dp), color = MaterialTheme.colorScheme.primary) }
                        }
                    }
                }
            }
        }
    }
}

private data class StreamAddonChoice(val id: String, val name: String)

private fun effectiveStreamAddonId(selectedAddonId: String?, choices: List<StreamAddonChoice>): String? =
    selectedAddonId?.takeIf { selectedId -> choices.size > 1 && choices.any { it.id == selectedId } }

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StreamSelectionScreen(
    title: String,
    artwork: String?,
    episode: VideoItem?,
    streams: List<StreamSource>,
    addonChoices: List<StreamAddonChoice>,
    selectedAddonId: String?,
    loading: Boolean,
    error: String?,
    onSelectAddon: (String?) -> Unit,
    onRetry: () -> Unit,
    onSelect: (StreamSource) -> Unit,
) {
    val listState = rememberLazyListState()
    val heroPull = remember { mutableFloatStateOf(0f) }
    val maxHeroPullPx = with(LocalDensity.current) { HeroMotion.maxPull.toPx() }
    val heroPullConnection = remember(listState, maxHeroPullPx) {
        HeroOverscrollConnection(
            atTop = {
                listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0
            },
            maxPullPx = maxHeroPullPx,
            pull = heroPull,
        )
    }
    val heroPullDp = with(LocalDensity.current) { heroPull.floatValue.toDp() }
    val heroScale = 1f + (heroPull.floatValue / maxHeroPullPx) * HeroMotion.expansionScale
    val collapsed by remember { derivedStateOf { listState.firstVisibleItemIndex > 0 } }
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().nestedScroll(heroPullConnection),
        overscrollEffect = null,
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        artwork?.let { image ->
            item(key = "artwork") {
                Box(Modifier.fillMaxWidth().height(170.dp + heroPullDp).clipToBounds()) {
                    AsyncImage(
                        image,
                        null,
                        Modifier.fillMaxSize().graphicsLayer {
                            scaleX = heroScale
                            scaleY = heroScale
                            translationY = -heroPull.floatValue * HeroMotion.upwardTranslation
                        },
                        contentScale = ContentScale.Crop,
                    )
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(.08f), MaterialTheme.colorScheme.background))))
                }
            }
        }
        stickyHeader(key = "stream-header") {
            Surface(color = MaterialTheme.colorScheme.background.copy(alpha = .96f), shadowElevation = if (collapsed) 8.dp else 0.dp) {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = if (collapsed) 4.dp else 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.width(48.dp))
                    Column { Text("Choose a stream", style = if (collapsed) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); if (!collapsed) Text(listOfNotNull(title, episode?.let { "S${it.season ?: 0}E${it.episode ?: 0} · ${it.displayTitle}" }).joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
        item(key = "addon-filters") {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    FilledTonalIconButton(onClick = onRetry, enabled = !loading) {
                        Icon(Icons.Rounded.Refresh, "Refresh sources")
                    }
                }
                item {
                    FilterChip(
                        selected = selectedAddonId == null,
                        onClick = { onSelectAddon(null) },
                        label = { Text("All") },
                    )
                }
                items(addonChoices, key = StreamAddonChoice::id) { addon ->
                    FilterChip(
                        selected = selectedAddonId == addon.id,
                        onClick = { onSelectAddon(addon.id) },
                        label = { Text(addon.name) },
                    )
                }
            }
        }
        when {
            loading -> item(key = "loading") { Box(Modifier.fillParentMaxHeight(.65f).fillMaxWidth().background(Color.Black.copy(alpha = .62f)), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) { CircularProgressIndicator(); Text("Finding streams…", color = Color.White.copy(alpha = .72f)) } } }
            streams.isEmpty() -> item(key = if (error != null) "error" else "empty") {
                Box(Modifier.fillParentMaxHeight(.65f).fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text(error ?: "No streams were returned.", color = error?.let { MaterialTheme.colorScheme.error } ?: MaterialTheme.colorScheme.onSurfaceVariant)
                        if (error != null) Button(onClick = onRetry) { Text("Try again") }
                    }
                }
            }
            else -> {
                if (error != null) {
                    item(key = "error") {
                        Text(error, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.error)
                    }
                }
                items(streams) { source ->
                Surface(color = Color.White.copy(alpha = .05f), shape = RoundedCornerShape(12.dp), modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth().clickable(enabled = source.stream.url != null) { onSelect(source) }) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(source.stream.name ?: source.stream.title ?: "Stream", fontWeight = FontWeight.Bold); source.stream.description?.let { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Text(source.addonName, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall) }
                        Icon(if (source.stream.url != null) Icons.Rounded.PlayArrow else Icons.Rounded.Link, null)
                    }
                }
                }
            }
        }
    }
}

internal enum class ProfileLaunchTarget { Settings, Addons, Manage }

internal data class ProfileLaunchRequest(
    val target: ProfileLaunchTarget,
    val sequence: Int,
)

@Composable
internal fun ProfileSettingsScreen(
    state: AppState,
    platform: PlatformInfo,
    account: AccountStatus.SignedIn,
    activeProfile: ProfileSummary?,
    profileSync: ProfileSyncState,
    api: ConduitApi,
    dispatch: (AppAction) -> Unit,
    onSignOut: () -> Unit,
    onProfilesChanged: (String?) -> Unit,
    onProfileFlowChanged: (Boolean) -> Unit,
    onProfileDataChanged: () -> Unit,
    onProfileMutation: suspend (ProfileMutation) -> Result<Unit>,
    onSelectMedia: (CatalogItem, String?) -> Unit,
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    settingsListState: androidx.compose.foundation.lazy.LazyListState = rememberLazyListState(),
    launchRequest: ProfileLaunchRequest? = null,
    modifier: Modifier = Modifier,
) {
    var route by remember { mutableStateOf<ProfileRoute>(ProfileRoute.Settings) }
    LaunchedEffect(launchRequest) {
        route = when (launchRequest?.target) {
            ProfileLaunchTarget.Addons -> ProfileRoute.Addons
            ProfileLaunchTarget.Manage -> ProfileRoute.Switcher
            ProfileLaunchTarget.Settings, null -> ProfileRoute.Settings
        }
    }
    LaunchedEffect(route) { onProfileFlowChanged(route != ProfileRoute.Settings) }
    DisposableEffect(Unit) { onDispose { onProfileFlowChanged(false) } }
    PlatformBackHandler(enabled = route != ProfileRoute.Settings) {
        when (route) {
            ProfileRoute.Settings -> Unit
            ProfileRoute.Overview -> route = ProfileRoute.Settings
            ProfileRoute.Switcher -> route = ProfileRoute.Overview
            ProfileRoute.Create -> route = ProfileRoute.Switcher
            is ProfileRoute.Edit -> route = ProfileRoute.Overview
            ProfileRoute.Diagnostics -> route = ProfileRoute.Advanced
            ProfileRoute.Addons,
            ProfileRoute.History,
            ProfileRoute.Account,
            ProfileRoute.Appearance,
            ProfileRoute.Content,
            ProfileRoute.Playback,
            ProfileRoute.Advanced,
            ProfileRoute.Integrations,
            ProfileRoute.Supporters,
            ProfileRoute.Privacy,
            ProfileRoute.Licenses -> route = ProfileRoute.Settings
        }
    }
    when (val current = route) {
        ProfileRoute.Overview -> return ProfileOverviewScreen(activeProfile, profileSync.snapshot, { route = ProfileRoute.Settings }, { route = ProfileRoute.Switcher }, { activeProfile?.let { route = ProfileRoute.Edit(it) } }, modifier)
        ProfileRoute.Switcher -> return ProfileSwitcherScreen(account.bootstrap.households.flatMap { it.profiles }, activeProfile, { route = ProfileRoute.Overview }, { route = ProfileRoute.Edit(it) }, { route = ProfileRoute.Create }, { dispatch(AppAction.SelectProfile(it.id)); route = ProfileRoute.Overview }, modifier)
        ProfileRoute.Create -> return ProfileEditorScreen(null, activeProfile, api, state, account, { route = ProfileRoute.Switcher }, onProfilesChanged, modifier)
        is ProfileRoute.Edit -> return ProfileEditorScreen(current.profile, activeProfile, api, state, account, { route = ProfileRoute.Overview }, onProfilesChanged, modifier)
        ProfileRoute.Addons -> return AddonManagerScreen(activeProfile, profileSync.snapshot?.addons.orEmpty(), api, state, account, { route = ProfileRoute.Settings }, onProfileDataChanged, modifier)
        ProfileRoute.History -> return WatchHistoryScreen(profileSync.snapshot, { route = ProfileRoute.Settings }, onSelectMedia, onProfileMutation, modifier)
        ProfileRoute.Account -> return AccountSettingsScreen(state, account, api, onSignOut, { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Appearance -> return AppearanceSettingsScreen(platform, preferences, onPreferencesChanged, { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Content -> return ContentSettingsScreen({ route = ProfileRoute.Settings }, { route = ProfileRoute.Addons }, modifier)
        ProfileRoute.Playback -> return PlaybackSettingsScreen(platform, preferences, onPreferencesChanged, { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Advanced -> return AdvancedSettingsScreen(preferences, onPreferencesChanged, { route = ProfileRoute.Settings }, { route = ProfileRoute.Diagnostics }, modifier)
        ProfileRoute.Integrations -> return InformationalSettingsScreen("Integrations", "Connected services", listOf("conduit currently uses your installed Stremio add-ons directly.", "Trakt, debrid, and metadata-service connections will appear here only when their credential storage and synchronization flows are implemented."), { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Supporters -> return InformationalSettingsScreen("Supporters & contributors", "conduit is open source", listOf("Contributors are acknowledged through the project repository.", "https://github.com/davidvanderklay/conduit", "A server-funding goal will appear here once a verified funding source is configured."), { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Privacy -> return InformationalSettingsScreen("Privacy policy", "Your server, your data", listOf("conduit stores account, profile, library, and viewing data on the server you choose.", "https://github.com/davidvanderklay/conduit#data-and-privacy-model"), { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Licenses -> return InformationalSettingsScreen("Licenses & attribution", "Open-source software", listOf("conduit - MIT License", "AndroidX Media3 - Apache License 2.0", "Ktor - Apache License 2.0", "Compose Multiplatform - Apache License 2.0", "Coil - Apache License 2.0", "https://github.com/davidvanderklay/conduit/blob/main/THIRD_PARTY_NOTICES.md"), { route = ProfileRoute.Settings }, modifier)
        ProfileRoute.Diagnostics -> return InformationalSettingsScreen("Debug information", "${platform.name} ${platform.version}", listOf("Device: ${platform.device}", "Server: ${state.endpoint?.baseUrl}", "Profile: ${activeProfile?.name ?: "None"}", "Add-ons: ${profileSync.snapshot?.addons?.size ?: 0}", "Debug logging: ${if (preferences.debugLogging) "enabled" else "disabled"}"), { route = ProfileRoute.Advanced }, modifier)
        ProfileRoute.Settings -> Unit
    }
    val sections = remember {
        listOf(
            SettingSection("Account", listOf(
                SettingEntry("Profile", "Profiles, appearance, and viewing overview", Icons.Rounded.AccountCircle),
                SettingEntry("Account", "Sign-in, security, and recovery", Icons.Rounded.Person),
            )),
            SettingSection("General", listOf(
                SettingEntry("Watch history", "Recent movies and episodes", Icons.Rounded.History),
                SettingEntry("Appearance & layout", "Theme, language, and navigation", Icons.Rounded.Tune),
                SettingEntry("Content & discovery", "Add-ons, catalogs, and search", Icons.Rounded.Explore),
                SettingEntry("Playback", "Player, subtitles, and behavior", Icons.Rounded.PlayCircle),
                SettingEntry("Integrations", "Connected media services", Icons.Rounded.Extension),
            )),
            SettingSection("About", listOf(
                SettingEntry("Supporters & contributors", "Community and open source", Icons.Rounded.Favorite),
                SettingEntry("Privacy policy", "Data and privacy details", Icons.Rounded.PrivacyTip),
                SettingEntry("Licenses & attribution", "Open-source software and acknowledgements", Icons.Rounded.Description),
            )),
            SettingSection("Advanced", listOf(
                SettingEntry("Advanced settings", "Server and diagnostics", Icons.Rounded.SettingsSuggest),
            )),
        )
    }
    var settingsQuery by remember { mutableStateOf("") }
    val visibleSections = remember(settingsQuery) {
        val query = settingsQuery.trim()
        sections.mapNotNull { section ->
            val entries = section.entries.filter { query.isBlank() || "${section.title} ${it.title} ${it.description}".contains(query, ignoreCase = true) }
            entries.takeIf { it.isNotEmpty() }?.let { SettingSection(section.title, it) }
        }
    }
    LazyColumn(
        state = settingsListState,
        modifier = modifier.statusBarsPadding(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 112.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
                ProfileAvatar(activeProfile, 58, Modifier.clickable { route = ProfileRoute.Overview })
                Spacer(Modifier.width(14.dp))
                Column { Text(activeProfile?.name ?: "Profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(state.endpoint?.label.orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        stickyHeader {
            OutlinedTextField(
                value = settingsQuery,
                onValueChange = { settingsQuery = it },
                modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background.copy(alpha = .97f)).padding(vertical = 6.dp),
                placeholder = { Text("Search settings") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                trailingIcon = if (settingsQuery.isNotBlank()) {{
                    IconButton(onClick = { settingsQuery = "" }) { Icon(Icons.Rounded.Close, "Clear") }
                }} else null,
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
            )
        }
        visibleSections.forEach { section ->
            item(key = "section-${section.title}") {
                Text(section.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 6.dp, top = 10.dp, bottom = 2.dp))
            }
            items(section.entries, key = { "${section.title}-${it.title}" }) { entry ->
                ListItem(
                    headlineContent = { Text(entry.title, fontWeight = FontWeight.Medium) },
                    supportingContent = { Text(entry.description) },
                    leadingContent = { Icon(entry.icon, null, tint = MaterialTheme.colorScheme.primary) },
                    trailingContent = { Icon(Icons.Rounded.ChevronRight, null) },
                    colors = ListItemDefaults.colors(containerColor = Color.White.copy(alpha = .035f)),
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { when (entry.title) {
                        "Profile" -> route = ProfileRoute.Overview
                        "Account" -> route = ProfileRoute.Account
                        "Watch history" -> route = ProfileRoute.History
                        "Appearance & layout" -> route = ProfileRoute.Appearance
                        "Content & discovery" -> route = ProfileRoute.Content
                        "Playback" -> route = ProfileRoute.Playback
                        "Integrations" -> route = ProfileRoute.Integrations
                        "Supporters & contributors" -> route = ProfileRoute.Supporters
                        "Privacy policy" -> route = ProfileRoute.Privacy
                        "Licenses & attribution" -> route = ProfileRoute.Licenses
                        "Advanced settings" -> route = ProfileRoute.Advanced
                    } },
                )
            }
        }
        if (visibleSections.isEmpty()) {
            item { Text("No settings match “$settingsQuery”.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
        }
        item {
            OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
            Text("${platform.name} ${platform.version} · ${profileSync.snapshot?.addons?.size ?: 0} add-ons", modifier = Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun SettingsPage(title: String, onBack: () -> Unit, modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxSize()) {
        ProfileHeader(title, onBack)
        Column(Modifier.weight(1f).verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 10.dp, vertical = 6.dp).navigationBarsPadding().padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
private fun SettingsGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 6.dp, top = 8.dp))
        Surface(color = Color.White.copy(.04f), shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Color.White.copy(.06f))) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), content = content)
        }
    }
}

@Composable
private fun SettingsToggle(title: String, description: String, checked: Boolean, enabled: Boolean = true, onChanged: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Medium, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant); Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.width(12.dp)); Switch(checked, onChanged, enabled = enabled)
    }
}

@Composable
private fun SettingsAction(title: String, description: String, destructive: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Medium, color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface); Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
        Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AccountSettingsScreen(state: AppState, account: AccountStatus.SignedIn, api: ConduitApi, onSignOut: () -> Unit, onBack: () -> Unit, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var methods by remember { mutableStateOf<AuthenticationMethods?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var changingPassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var recoveryCodes by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(account.session.token) { methods = runCatching { api.authenticationMethods(state.endpoint!!.baseUrl, account.session.token) }.getOrElse { message = it.message; null } }
    SettingsPage("Account", onBack, modifier) {
        SettingsGroup("STATUS") {
            ListItem(headlineContent = { Text("Signed in", fontWeight = FontWeight.SemiBold) }, supportingContent = { Text(account.bootstrap.user?.email ?: "conduit account") }, leadingContent = { Icon(Icons.Rounded.VerifiedUser, null, tint = Color(0xFF34D399)) }, colors = ListItemDefaults.colors(containerColor = Color.Transparent))
            HorizontalDivider(color = Color.White.copy(.06f))
            ListItem(headlineContent = { Text("Server") }, supportingContent = { Text(state.endpoint?.baseUrl.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis) }, colors = ListItemDefaults.colors(containerColor = Color.Transparent))
        }
        SettingsGroup("SECURITY") {
            SettingsAction(if (methods?.passwordEnabled == true) "Change password" else "Enable password", if (methods == null) "Loading authentication methods…" else "Use email and password to sign in") { changingPassword = true }
            if (methods?.passwordEnabled == true) {
                HorizontalDivider(color = Color.White.copy(.06f))
                SettingsAction("Disable password", if (methods?.linkedProviders?.isNotEmpty() == true) "Continue signing in with ${methods?.configuredProviderName ?: "your linked provider"}" else "Link another provider before disabling", destructive = true) {
                    scope.launch { runCatching { api.setPasswordMode(state.endpoint!!.baseUrl, account.session.token, false) }.onSuccess { methods = methods?.copy(passwordEnabled = it); message = "Password disabled" }.onFailure { message = it.message } }
                }
            }
            HorizontalDivider(color = Color.White.copy(.06f))
            SettingsAction("Generate new recovery codes", "Old unused codes will stop working") { scope.launch { runCatching { api.generateRecoveryCodes(state.endpoint!!.baseUrl, account.session.token) }.onSuccess { recoveryCodes = it }.onFailure { message = it.message } } }
        }
        message?.let { Text(it, color = if (it.contains("disabled")) Color(0xFF34D399) else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 6.dp)) }
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Icon(Icons.Rounded.Logout, null); Spacer(Modifier.width(8.dp)); Text("Sign out") }
    }
    if (changingPassword) AlertDialog(onDismissRequest = { changingPassword = false }, title = { Text(if (methods?.passwordEnabled == true) "Change password" else "Enable password") }, text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { if (methods?.passwordEnabled == true) OutlinedTextField(currentPassword, { currentPassword = it }, label = { Text("Current password") }, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), singleLine = true); OutlinedTextField(password, { password = it }, label = { Text("New password") }, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), singleLine = true) } }, dismissButton = { TextButton({ changingPassword = false }) { Text("Cancel") } }, confirmButton = { Button(enabled = password.length >= 8, onClick = { scope.launch { runCatching { api.setPasswordMode(state.endpoint!!.baseUrl, account.session.token, true, password, currentPassword.takeIf { methods?.passwordEnabled == true && it.isNotEmpty() }) }.onSuccess { methods = methods?.copy(passwordEnabled = it); changingPassword = false; password = ""; currentPassword = ""; message = "Password updated" }.onFailure { message = it.message } } }) { Text("Save") } })
    if (recoveryCodes.isNotEmpty()) AlertDialog(onDismissRequest = {}, title = { Text("Save your recovery codes") }, text = { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Text("Each code can be used once. Store them somewhere safe.", color = MaterialTheme.colorScheme.onSurfaceVariant); recoveryCodes.forEach { code -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text(code, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); IconButton({ clipboard.setText(AnnotatedString(code)) }) { Icon(Icons.Rounded.ContentCopy, "Copy code") } } }; OutlinedButton({ clipboard.setText(AnnotatedString(recoveryCodes.joinToString("\n"))) }, Modifier.fillMaxWidth()) { Icon(Icons.Rounded.ContentCopy, null); Spacer(Modifier.width(8.dp)); Text("Copy all") } } }, confirmButton = { Button({ recoveryCodes = emptyList() }) { Text("I saved them") } })
}

@Composable
private fun AppearanceSettingsScreen(platform: PlatformInfo, preferences: DevicePreferences, update: (DevicePreferences) -> Unit, onBack: () -> Unit, modifier: Modifier) {
    var showNavigation by remember { mutableStateOf(false) }
    val isIos = platform.name.equals("iOS", ignoreCase = true)
    val navigationStyles = if (isIos) {
        listOf(NavigationStyle.Adaptive, NavigationStyle.Expanded, NavigationStyle.Classic)
    } else {
        NavigationStyle.entries
    }
    val effectiveNavigationStyle = preferences.navigationStyle.takeUnless {
        isIos && it == NavigationStyle.Compact
    } ?: NavigationStyle.Adaptive
    SettingsPage("Appearance & layout", onBack, modifier) {
        SettingsGroup("THEME") {
            ListItem(headlineContent = { Text("Theme") }, supportingContent = { Text("conduit dark") }, leadingContent = { Icon(Icons.Rounded.DarkMode, null) }, colors = ListItemDefaults.colors(containerColor = Color.Transparent))
            SettingsToggle("AMOLED black", "Use pure black backgrounds on OLED displays", preferences.amoledBlack) { update(preferences.copy(amoledBlack = it)) }
            SettingsToggle("Reduce animations", "Use simpler transitions and motion", preferences.reduceAnimations) { update(preferences.copy(reduceAnimations = it)) }
        }
        SettingsGroup("DISPLAY") {
            SettingsAction("App language", "System default") { }
            HorizontalDivider(color = Color.White.copy(.06f))
            SettingsAction("Navigation style", effectiveNavigationStyle.description) { showNavigation = true }
        }
    }
    if (showNavigation) AlertDialog(onDismissRequest = { showNavigation = false }, title = { Text("Navigation style") }, text = { Column { navigationStyles.forEach { style -> Row(Modifier.fillMaxWidth().clickable { update(preferences.copy(navigationStyle = style)); showNavigation = false }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { RadioButton(style == effectiveNavigationStyle, null); Spacer(Modifier.width(8.dp)); Column { Text(style.label); Text(style.description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) } } } } }, confirmButton = {})
}

@Composable
private fun ContentSettingsScreen(onBack: () -> Unit, onAddons: () -> Unit, modifier: Modifier) = SettingsPage("Content & discovery", onBack, modifier) {
    SettingsGroup("SOURCES") { SettingsAction("Add-ons", "Install, order, and manage Stremio add-ons", onClick = onAddons) }
    SettingsGroup("DISCOVERY") { ListItem(headlineContent = { Text("Catalog customization") }, supportingContent = { Text("Catalog ordering and home customization are coming next") }, colors = ListItemDefaults.colors(containerColor = Color.Transparent)) }
}

@Composable
private fun PlaybackSettingsScreen(platform: PlatformInfo, preferences: DevicePreferences, update: (DevicePreferences) -> Unit, onBack: () -> Unit, modifier: Modifier) {
    val languages = listOf("System default", "English", "Spanish", "French", "German", "Japanese", "Korean")
    var picker by remember { mutableStateOf<String?>(null) }
    SettingsPage("Playback", onBack, modifier) {
        SettingsGroup("PLAYER") {
            SettingsToggle("Auto-select saved streams", "Reuse the last selected stream when it is available", preferences.autoSelectSavedStreams) { update(preferences.copy(autoSelectSavedStreams = it)) }
            SettingsToggle("Miniplayer on back", "Minimize playback instead of closing it when you press Back", preferences.miniplayerOnBack) { update(preferences.copy(miniplayerOnBack = it)) }
            SettingsToggle("Touch gestures", "Double-tap seeking and player gestures", preferences.touchGestures) { update(preferences.copy(touchGestures = it)) }
            SettingsToggle("Hold to speed", "Hold the player to temporarily speed up", preferences.holdToSpeed) { update(preferences.copy(holdToSpeed = it)) }
        }
        SettingsGroup("AUDIO & SUBTITLES") {
            SettingsAction("Preferred audio language", preferences.preferredAudioLanguage) { picker = "audio" }
            HorizontalDivider(color = Color.White.copy(.06f)); SettingsAction("Preferred subtitle language", preferences.preferredSubtitleLanguage) { picker = "subtitle" }
            HorizontalDivider(color = Color.White.copy(.06f)); SettingsToggle("Subtitle outline", "Improve readability on bright scenes", preferences.subtitleOutline) { update(preferences.copy(subtitleOutline = it)) }
        }
        SettingsGroup("AUTOPLAY") { SettingsToggle("Autoplay next episode", "Continue after the next-episode prompt", preferences.autoplayNextEpisode) { update(preferences.copy(autoplayNextEpisode = it)) } }
        SettingsGroup("P2P STREAMING") {
            SettingsToggle("Allow P2P sources", if (platform.p2pAvailable) "Master permission for peer-to-peer playback on this device" else "Not available in this build", preferences.p2pEnabled && platform.p2pAvailable, enabled = platform.p2pAvailable) { update(preferences.copy(p2pEnabled = it)) }
            if (!platform.p2pAvailable) Text("This distribution does not include a P2P engine. Builds that permit P2P can expose this switch without changing the rest of the playback settings.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 12.dp))
        }
    }
    if (picker != null) AlertDialog(onDismissRequest = { picker = null }, title = { Text(if (picker == "audio") "Preferred audio language" else "Preferred subtitle language") }, text = { Column { languages.forEach { language -> Row(Modifier.fillMaxWidth().clickable { if (picker == "audio") update(preferences.copy(preferredAudioLanguage = language)) else update(preferences.copy(preferredSubtitleLanguage = language)); picker = null }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { RadioButton((if (picker == "audio") preferences.preferredAudioLanguage else preferences.preferredSubtitleLanguage) == language, null); Spacer(Modifier.width(8.dp)); Text(language) } } } }, confirmButton = {})
}

@Composable
private fun AdvancedSettingsScreen(preferences: DevicePreferences, update: (DevicePreferences) -> Unit, onBack: () -> Unit, onDiagnostics: () -> Unit, modifier: Modifier) = SettingsPage("Advanced settings", onBack, modifier) {
    SettingsGroup("STARTUP") { SettingsToggle("Remember last profile", "Return to the profile used on this device", preferences.rememberLastProfile) { update(preferences.copy(rememberLastProfile = it)) } }
    SettingsGroup("CACHE") { ListItem(headlineContent = { Text("Continue Watching cache") }, supportingContent = { Text("Viewing progress currently comes directly from your server; there is no separate local cache to clear") }, colors = ListItemDefaults.colors(containerColor = Color.Transparent)) }
    SettingsGroup("DIAGNOSTICS") { SettingsToggle("Debug logging", "Collect additional local diagnostic information", preferences.debugLogging) { update(preferences.copy(debugLogging = it)) }; SettingsAction("View debug information", "Device, server, and build details", onClick = onDiagnostics) }
}

@Composable
private fun InformationalSettingsScreen(title: String, heading: String, paragraphs: List<String>, onBack: () -> Unit, modifier: Modifier) = SettingsPage(title, onBack, modifier) {
    val uriHandler = LocalUriHandler.current
    SettingsGroup(heading.uppercase()) { paragraphs.forEachIndexed { index, paragraph ->
        if (index > 0) HorizontalDivider(color = Color.White.copy(.06f))
        val isLink = paragraph.startsWith("https://")
        Row(Modifier.fillMaxWidth().then(if (isLink) Modifier.clickable { uriHandler.openUri(paragraph) } else Modifier).padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(paragraph.removePrefix("https://"), color = if (isLink) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, textDecoration = if (isLink) androidx.compose.ui.text.style.TextDecoration.Underline else null)
            if (isLink) Icon(Icons.Rounded.OpenInNew, "Open externally", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 10.dp))
        }
    } }
}

private sealed interface ProfileRoute {
    data object Settings : ProfileRoute
    data object Overview : ProfileRoute
    data object Switcher : ProfileRoute
    data object Create : ProfileRoute
    data object Addons : ProfileRoute
    data object History : ProfileRoute
    data object Account : ProfileRoute
    data object Appearance : ProfileRoute
    data object Content : ProfileRoute
    data object Playback : ProfileRoute
    data object Advanced : ProfileRoute
    data object Integrations : ProfileRoute
    data object Supporters : ProfileRoute
    data object Privacy : ProfileRoute
    data object Licenses : ProfileRoute
    data object Diagnostics : ProfileRoute
    data class Edit(val profile: ProfileSummary) : ProfileRoute
}

@Composable
private fun WatchHistoryScreen(
    snapshot: ProfileSnapshot?,
    onBack: () -> Unit,
    onSelect: (CatalogItem, String?) -> Unit,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    modifier: Modifier,
) {
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val history = snapshot?.history.orEmpty()
    Column(modifier.fillMaxSize()) {
        ProfileHeader("Watch history", onBack)
        when {
            snapshot == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            history.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text("Nothing watched yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(170.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(history, key = ProgressSummary::videoId) { progress ->
                    val item = CatalogItem(progress.mediaId, progress.mediaType, progress.name, poster = progress.poster)
                    RichProgressCard(
                        progress = progress,
                        onClick = { onSelect(item, progress.videoId) },
                        onActions = { actionTarget = MediaActionTarget(item, MediaActionContext.History, progress) },
                    )
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = snapshot,
        onDismiss = { actionTarget = null },
        onPlay = { onSelect(it.item, it.progress?.videoId) },
        onDetails = { onSelect(it, null) },
        onMutation = onMutation,
    )
}

@Composable
private fun MobileBackButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    background: Color = Color.Transparent,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    safeArea: Boolean = false,
) {
    IconButton(
        onClick = onClick,
        modifier = modifier
            .then(if (safeArea) Modifier.statusBarsPadding().padding(12.dp) else Modifier)
            .background(background, CircleShape),
    ) {
        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = tint)
    }
}

@Composable
private fun ProfileHeader(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        MobileBackButton(onClick = onBack)
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ProfileAvatar(profile: ProfileSummary?, size: Int, modifier: Modifier = Modifier, edit: Boolean = false) {
    val color = profile?.avatarColor?.let(::profileColor) ?: MaterialTheme.colorScheme.primary
    Box(modifier.size(size.dp)) {
        Surface(shape = CircleShape, color = color, contentColor = Color.White, modifier = Modifier.fillMaxSize()) {
            if (!profile?.avatarUrl.isNullOrBlank()) AsyncImage(profile?.avatarUrl, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else Box(contentAlignment = Alignment.Center) { Text(profile?.name?.take(1)?.uppercase() ?: "P", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        }
        if (edit) Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary, modifier = Modifier.align(Alignment.BottomEnd).size(28.dp)) {
            Icon(Icons.Rounded.Edit, null, Modifier.padding(6.dp), tint = MaterialTheme.colorScheme.onPrimary)
        }
    }
}

private fun profileColor(hex: String): Color = runCatching {
    Color((0xFF000000L or hex.removePrefix("#").toLong(16)).toInt())
}.getOrDefault(Color(0xFFFFC107))

@Composable
private fun ProfileOverviewScreen(profile: ProfileSummary?, snapshot: ProfileSnapshot?, onBack: () -> Unit, onSwitch: () -> Unit, onEdit: () -> Unit, modifier: Modifier) {
    val continued = snapshot?.continueWatching?.distinctBy { "${it.mediaType}:${it.mediaId}" }?.size ?: 0
    val library = snapshot?.library?.size ?: 0
    val completed = snapshot?.progress?.filter { it.watched }?.distinctBy { "${it.mediaType}:${it.mediaId}" }?.size ?: 0
    val trackedMs = snapshot?.progress.orEmpty()
        .distinctBy { it.videoId }
        .sumOf { progress ->
            val validDuration = progress.durationMs.takeIf { it in 1..21_600_000 }
            when {
                progress.watched && validDuration != null -> validDuration
                validDuration != null -> progress.positionMs.coerceIn(0, validDuration)
                else -> 0L
            }
        }
    val trackedTime = when {
        trackedMs <= 0 -> "—"
        trackedMs >= 3_600_000 -> "${trackedMs / 3_600_000} h"
        else -> "${trackedMs / 60_000} m"
    }
    Column(modifier.fillMaxSize()) {
        ProfileHeader("Profile", onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 130.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Row(Modifier.padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onSwitch, modifier = Modifier.weight(1f).height(58.dp)) { Icon(Icons.Rounded.People, null); Spacer(Modifier.width(8.dp)); Text("Switch profile") }
            OutlinedButton(onClick = onEdit, modifier = Modifier.weight(1f).height(58.dp)) { Icon(Icons.Rounded.Edit, null); Spacer(Modifier.width(8.dp)); Text("Edit profile") }
        } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFF151914))) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { ProfileAvatar(profile, 76); Spacer(Modifier.width(16.dp)); Column { Text("${profile?.name ?: "Your"}'s profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text("Your viewing activity and saved content", color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(Triple(continued, "Continue", Icons.Rounded.PlayArrow), Triple(library, "Library", Icons.Rounded.VideoLibrary), Triple(0, "Upcoming", Icons.Rounded.Event)).forEach { (value, label, _) -> Surface(color = Color.White.copy(.07f), shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f)) { Column(Modifier.padding(12.dp)) { Text("$value", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(label, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant) } } } }
            }
        } }
        item { Text("Overview", modifier = Modifier.padding(horizontal = 10.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        item { Column(Modifier.padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(
                listOf(StatCardData("$continued", "Continue watching", "Titles currently in progress", Icons.Rounded.PlayArrow), StatCardData("$completed", "Completed", "Movies and series you finished", Icons.Rounded.Favorite)),
                listOf(StatCardData("$library", "Library", "Titles saved to your library", Icons.Rounded.VideoLibrary), StatCardData(trackedTime, "Tracked progress", "Unique video checkpoints", Icons.Rounded.AutoAwesome)),
                listOf(StatCardData("${snapshot?.progress?.take(7)?.size ?: 0}", "Recent activity", "Latest history entries", Icons.Rounded.Notifications), StatCardData("0", "Upcoming", "Saved upcoming releases", Icons.Rounded.Event)),
            ).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { pair.forEach { StatCard(it, Modifier.weight(1f)) } } }
        } }
        }
    }
}

private data class StatCardData(val value: String, val title: String, val detail: String, val icon: ImageVector)
@Composable private fun StatCard(data: StatCardData, modifier: Modifier) { Surface(color = Color.White.copy(.065f), shape = RoundedCornerShape(18.dp), modifier = modifier.height(154.dp)) { Column(Modifier.padding(16.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Text(data.value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); Icon(data.icon, null, tint = MaterialTheme.colorScheme.primary) }; Spacer(Modifier.height(12.dp)); Text(data.title, style = MaterialTheme.typography.titleMedium); Text(data.detail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) } } }

@Composable
private fun ProfileSwitcherScreen(profiles: List<ProfileSummary>, active: ProfileSummary?, onBack: () -> Unit, onEdit: (ProfileSummary) -> Unit, onCreate: () -> Unit, onSelect: (ProfileSummary) -> Unit, modifier: Modifier) {
    var managing by remember { mutableStateOf(false) }
    Column(modifier.background(Brush.verticalGradient(listOf(Color(0xFF171706), Color.Black)))) {
        ProfileHeader("Who's watching?", onBack)
        LazyVerticalGrid(columns = GridCells.Fixed(2), modifier = Modifier.weight(1f), contentPadding = PaddingValues(28.dp), horizontalArrangement = Arrangement.spacedBy(26.dp), verticalArrangement = Arrangement.spacedBy(30.dp)) {
            items(profiles, key = { it.id }) { profile -> Column(Modifier.clickable { if (managing) onEdit(profile) else onSelect(profile) }, horizontalAlignment = Alignment.CenterHorizontally) { ProfileAvatar(profile, 116, edit = managing); Spacer(Modifier.height(10.dp)); Text(profile.name, fontWeight = if (profile.id == active?.id) FontWeight.Bold else FontWeight.Medium, style = MaterialTheme.typography.titleMedium) } }
            item { Column(Modifier.clickable(onClick = onCreate), horizontalAlignment = Alignment.CenterHorizontally) { Surface(shape = CircleShape, color = Color.White.copy(.06f), border = BorderStroke(2.dp, Color.White.copy(.18f)), modifier = Modifier.size(116.dp)) { Icon(Icons.Rounded.Add, "Add profile", Modifier.padding(35.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }; Spacer(Modifier.height(10.dp)); Text("Add profile", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleMedium) } }
        }
        OutlinedButton(onClick = { managing = !managing }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 34.dp).widthIn(min = 210.dp)) { Text(if (managing) "Done" else "Manage profiles") }
    }
}

@Composable
private fun ProfileEditorScreen(profile: ProfileSummary?, active: ProfileSummary?, api: ConduitApi, state: AppState, account: AccountStatus.SignedIn, onBack: () -> Unit, onSaved: (String?) -> Unit, modifier: Modifier) {
    val scope = rememberCoroutineScope(); var name by remember { mutableStateOf(profile?.name.orEmpty()) }; var kids by remember { mutableStateOf(profile?.isKids ?: false) }; var color by remember { mutableStateOf(profile?.avatarColor ?: "#FFC107") }; var url by remember { mutableStateOf(profile?.avatarUrl.orEmpty()) }; var avatarMode by remember { mutableStateOf(if (profile?.avatarUrl.isNullOrBlank()) "color" else "image") }; var saving by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    val colors = listOf("#FFC107", "#FF8F00", "#E53935", "#8E24AA", "#3949AB", "#039BE5", "#00897B", "#43A047")
    val primary = account.bootstrap.households.firstOrNull { household -> household.profiles.any { it.id == (profile?.id ?: active?.id) } }?.profiles?.firstOrNull()
    val canUsePrimary = profile == null || profile.id != primary?.id
    var usesPrimaryAddons by remember { mutableStateOf(profile?.usesPrimaryAddons ?: false) }
    val preview = ProfileSummary(profile?.id ?: "new", name.ifBlank { "P" }, kids, usesPrimaryAddons, color.takeIf { avatarMode == "color" }, url.trim().ifBlank { null }.takeIf { avatarMode == "image" })
    Column(modifier.fillMaxSize()) {
        ProfileHeader(if (profile == null) "Add Profile" else "Edit Profile", onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 130.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Column(Modifier.padding(horizontal = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) { ProfileAvatar(preview, 104); Spacer(Modifier.height(10.dp)); Text(name.ifBlank { "New profile" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Profile name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Kids profile", fontWeight = FontWeight.Medium); Text("Use a child-friendly profile", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(kids, { kids = it }) }
            if (canUsePrimary) Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Use primary add-ons", fontWeight = FontWeight.Medium); Text("Share ${primary?.name ?: "the primary profile"}'s live add-on setup", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(usesPrimaryAddons, { usesPrimaryAddons = it }) }
        } } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Text("Avatar", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { FilterChip(selected = avatarMode == "color", onClick = { avatarMode = "color" }, label = { Text("Profile color") }); FilterChip(selected = avatarMode == "image", onClick = { avatarMode = "image" }, label = { Text("Custom image") }) }; if (avatarMode == "color") { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { colors.forEach { option -> Surface(shape = CircleShape, color = profileColor(option), border = if (color.equals(option, ignoreCase = true)) BorderStroke(3.dp, Color.White) else null, modifier = Modifier.size(32.dp).clickable { color = option }) {} } }; CustomProfileColorPicker(color = color, onColorChange = { color = it }) } else { Text("Enter an HTTP or HTTPS image link.", color = MaterialTheme.colorScheme.onSurfaceVariant); OutlinedTextField(url, { url = it }, placeholder = { Text("https://example.com/avatar.png") }, singleLine = true, modifier = Modifier.fillMaxWidth()) } } } }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 18.dp)) } }
        item { Button(onClick = { scope.launch { saving = true; error = null; runCatching { val endpoint = requireNotNull(state.endpoint); val cleanUrl = url.trim().ifBlank { null }.takeIf { avatarMode == "image" }; val cleanColor = color.takeIf { avatarMode == "color" }; require(cleanUrl == null || cleanUrl.startsWith("https://") || cleanUrl.startsWith("http://")) { "Avatar URL must begin with http:// or https://" }; require(avatarMode != "image" || cleanUrl != null) { "Enter a custom image URL" }; require(name.isNotBlank()) { "Enter a profile name" }; if (profile == null) { val household = account.bootstrap.households.first(); api.createProfile(endpoint.baseUrl, account.session.token, household.id, name, kids, usesPrimaryAddons, cleanColor, cleanUrl) } else api.updateProfile(endpoint.baseUrl, account.session.token, profile.id, name, kids, usesPrimaryAddons, cleanColor, cleanUrl) }.onSuccess { onSaved(it.id); onBack() }.onFailure { error = it.message ?: "Unable to save profile" }; saving = false } }, enabled = !saving, modifier = Modifier.padding(horizontal = 10.dp).fillMaxWidth().height(54.dp)) { if (saving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (profile == null) "Create profile" else "Save changes") } }
        }
    }
}

private data class ProfileHsv(val hue: Float, val saturation: Float, val value: Float)

@Composable
private fun CustomProfileColorPicker(color: String, onColorChange: (String) -> Unit) {
    val selected = profileColor(color)
    var hsv by remember(color) { mutableStateOf(selected.toProfileHsv()) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Custom color", style = MaterialTheme.typography.labelLarge)
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(112.dp)
                .clip(RoundedCornerShape(12.dp))
                .pointerInput(hsv) {
                    detectTapGestures { position ->
                        val saturation = (position.x / size.width).coerceIn(0f, 1f)
                        val value = (1f - position.y / size.height).coerceIn(0f, 1f)
                        hsv = hsv.copy(saturation = saturation, value = value)
                        onColorChange(hsv.toColor().toHex())
                    }
                },
        ) {
            drawRect(Brush.horizontalGradient(listOf(Color.White, hsvToColor(hsv.hue, 1f, 1f))))
            drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
            val selector = Offset(size.width * hsv.saturation, size.height * (1f - hsv.value))
            drawCircle(Color.Black, radius = 8.dp.toPx(), center = selector)
            drawCircle(Color.White, radius = 6.dp.toPx(), center = selector, style = Stroke(width = 2.dp.toPx()))
        }
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(20.dp)
                .clip(RoundedCornerShape(50))
                .pointerInput(hsv) {
                    detectTapGestures { position ->
                        val hue = (position.x / size.width * 360f).coerceIn(0f, 360f)
                        hsv = hsv.copy(hue = hue)
                        onColorChange(hsv.toColor().toHex())
                    }
                },
        ) {
            drawRect(Brush.horizontalGradient(profileHueColors))
            drawCircle(Color.White, radius = size.height / 2f, center = Offset(size.width * hsv.hue / 360f, size.height / 2f))
            drawCircle(Color.Black, radius = size.height / 2f - 2.dp.toPx(), center = Offset(size.width * hsv.hue / 360f, size.height / 2f), style = Stroke(width = 2.dp.toPx()))
        }
        Text(color.uppercase(), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
    }
}

private val profileHueColors = listOf(Color.Red, Color.Yellow, Color.Green, Color.Cyan, Color.Blue, Color.Magenta, Color.Red)

private fun Color.toProfileHsv(): ProfileHsv {
    val maxChannel = max(red, max(green, blue))
    val minChannel = min(red, min(green, blue))
    val delta = maxChannel - minChannel
    val hue = when {
        delta == 0f -> 0f
        maxChannel == red -> 60f * (((green - blue) / delta) % 6f)
        maxChannel == green -> 60f * ((blue - red) / delta + 2f)
        else -> 60f * ((red - green) / delta + 4f)
    }.let { if (it < 0f) it + 360f else it }
    return ProfileHsv(hue, if (maxChannel == 0f) 0f else delta / maxChannel, maxChannel)
}

private fun ProfileHsv.toColor(): Color = hsvToColor(hue, saturation, value)

private fun hsvToColor(hue: Float, saturation: Float, value: Float): Color {
    val chroma = value * saturation
    val x = chroma * (1f - abs((hue / 60f % 2f) - 1f))
    val match = value - chroma
    val channels = when {
        hue < 60f -> Triple(chroma, x, 0f)
        hue < 120f -> Triple(x, chroma, 0f)
        hue < 180f -> Triple(0f, chroma, x)
        hue < 240f -> Triple(0f, x, chroma)
        hue < 300f -> Triple(x, 0f, chroma)
        else -> Triple(chroma, 0f, x)
    }
    return Color(channels.first + match, channels.second + match, channels.third + match)
}

private fun Color.toHex(): String = "#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}"

private fun hexChannel(value: Float): String = (value * 255f).roundToInt().toString(16).uppercase().padStart(2, '0')

internal fun normalizeManifestUrl(value: String): String = value.trim()

@Composable
private fun AddonManagerScreen(
    profile: ProfileSummary?, initialAddons: List<InstalledAddonSummary>, api: ConduitApi,
    state: AppState, account: AccountStatus.SignedIn, onBack: () -> Unit,
    onChanged: () -> Unit, modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    var addons by remember(initialAddons) { mutableStateOf(initialAddons) }
    var manifestUrl by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var removeTarget by remember { mutableStateOf<InstalledAddonSummary?>(null) }
    val linked = profile?.usesPrimaryAddons == true
    fun runMutation(onSuccess: () -> Unit = {}, block: suspend (String, String, String) -> Unit) {
        val endpoint = state.endpoint ?: return
        val profileId = profile?.id ?: return
        scope.launch {
            busy = true; error = null
            runCatching {
                block(endpoint.baseUrl, account.session.token, profileId)
                addons = api.synchronizeProfile(endpoint.baseUrl, account.session.token, profileId).addons
                onChanged()
                onSuccess()
            }.onFailure { error = it.message ?: "Unable to update add-ons" }
            busy = false
        }
    }
    removeTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            title = { Text("Remove add-on?") },
            text = { Text("${target.manifest["name"]?.jsonPrimitive?.contentOrNull ?: target.manifestId} will stop providing catalogs and streams for this profile.") },
            confirmButton = { TextButton(onClick = { removeTarget = null; runMutation { base, token, id -> api.removeAddon(base, token, id, target.id) } }) { Text("Remove", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { removeTarget = null }) { Text("Cancel") } },
        )
    }
    val activeCount = addons.count { it.enabled }
    val catalogCount = addons.filter { it.enabled }.sumOf { it.manifest["catalogs"]?.let { value -> runCatching { value.jsonArray.size }.getOrDefault(0) } ?: 0 }
    Column(modifier.fillMaxSize()) {
        ProfileHeader("Add-ons", onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { AddonSectionLabel("Overview") }
        item { Surface(color = Color.White.copy(.075f), shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                listOf(addons.size to "Add-ons", activeCount to "Active", catalogCount to "Catalogs").forEachIndexed { index, stat ->
                    if (index > 0) VerticalDivider(Modifier.height(54.dp), color = Color.White.copy(.1f))
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) { Text("${stat.first}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(stat.second, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        } }
        if (linked) item {
            Surface(color = MaterialTheme.colorScheme.primary.copy(.1f), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.Link, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(12.dp)); Column { Text("Using primary add-ons", fontWeight = FontWeight.Bold); Text("This list is managed by the primary profile.", color = MaterialTheme.colorScheme.onSurfaceVariant) } }
            }
        } else {
            item { AddonSectionLabel("Add add-on") }
            item { Surface(color = Color.White.copy(.075f), shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(manifestUrl, { manifestUrl = it }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("https://…/manifest.json") }, singleLine = true)
                Button(
                    onClick = {
                        val url = normalizeManifestUrl(manifestUrl)
                        runMutation(onSuccess = { manifestUrl = "" }) { base, token, id ->
                            api.installAddon(base, token, id, url)
                        }
                    },
                    enabled = !busy && normalizeManifestUrl(manifestUrl).isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text(if (busy) "Verifying…" else "Install add-on") }
            } } }
        }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) } }
        item { AddonSectionLabel("Installed add-ons") }
        if (addons.isEmpty()) item { Text("No add-ons installed.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp)) }
        items(addons, key = { it.id }) { addon ->
            val index = addons.indexOfFirst { it.id == addon.id }
            val name = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
            val description = addon.manifest["description"]?.jsonPrimitive?.contentOrNull ?: addon.manifestUrl
            val version = addon.manifest["version"]?.jsonPrimitive?.contentOrNull
            val logo = addon.manifest["logo"]?.jsonPrimitive?.contentOrNull
            val resources = addon.manifest["resources"]?.let { runCatching { it.jsonArray.size }.getOrDefault(0) } ?: 0
            val catalogs = addon.manifest["catalogs"]?.let { runCatching { it.jsonArray.size }.getOrDefault(0) } ?: 0
            val types = addon.manifest["types"]?.let { value -> runCatching { value.jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull } }.getOrDefault(emptyList()) } ?: emptyList()
            val hints = addon.manifest["behaviorHints"]?.let { runCatching { it.jsonObject }.getOrNull() }
            val configurable = hints?.get("configurable")?.jsonPrimitive?.booleanOrNull == true || hints?.get("configurationRequired")?.jsonPrimitive?.booleanOrNull == true
            Surface(color = Color.White.copy(.075f), shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(14.dp), color = Color.White.copy(.045f), modifier = Modifier.size(62.dp)) {
                            if (!logo.isNullOrBlank()) AsyncImage(logo, "$name logo", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                            else Icon(Icons.Rounded.Extension, null, Modifier.padding(16.dp), tint = MaterialTheme.colorScheme.primary)
                        }
                        Spacer(Modifier.width(14.dp)); Column(Modifier.weight(1f)) { Text(name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); version?.let { Text("Version $it", color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                        Switch(addon.enabled, { enabled -> runMutation { base, token, id -> api.setAddonEnabled(base, token, id, addon.id, enabled) } }, enabled = !linked && !busy)
                    }
                    if (!linked) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        IconButton(onClick = { runMutation { base, token, id -> api.moveAddon(base, token, id, addon.id, index - 1) } }, enabled = index > 0 && !busy) { Icon(Icons.Rounded.ArrowUpward, "Move $name up") }
                        IconButton(onClick = { runMutation { base, token, id -> api.moveAddon(base, token, id, addon.id, index + 1) } }, enabled = index < addons.lastIndex && !busy) { Icon(Icons.Rounded.ArrowDownward, "Move $name down") }
                        IconButton(onClick = { runMutation { base, token, id -> api.installAddon(base, token, id, addon.manifestUrl) } }, enabled = !busy) { Icon(Icons.Rounded.Refresh, "Refresh $name") }
                        if (configurable) Icon(Icons.Rounded.Settings, "Configurable", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(12.dp))
                        IconButton(onClick = { removeTarget = addon }, enabled = !busy) { Icon(Icons.Rounded.DeleteOutline, "Remove $name", tint = MaterialTheme.colorScheme.error) }
                    }
                    HorizontalDivider(color = Color.White.copy(.08f))
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { AddonBadge(if (addon.enabled) "Active" else "Disabled"); AddonBadge("$resources resources"); AddonBadge("$catalogs catalogs") }
                    if (configurable) AddonBadge("Configurable")
                    Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val capability = (types + listOfNotNull(addon.manifest["resources"]?.let { "resources" })).distinct().joinToString(" / ")
                    if (capability.isNotBlank()) Text(capability, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (busy) item { LinearProgressIndicator(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) }
        }
    }
}

@Composable private fun AddonSectionLabel(text: String) { Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, start = 2.dp)) }
@Composable private fun AddonBadge(text: String) { Surface(color = Color.White.copy(.06f), shape = RoundedCornerShape(50)) { Text(text, Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }

private data class SettingEntry(val title: String, val description: String, val icon: ImageVector)
private data class SettingSection(val title: String, val entries: List<SettingEntry>)
