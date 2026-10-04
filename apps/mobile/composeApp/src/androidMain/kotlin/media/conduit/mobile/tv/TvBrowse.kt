@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package media.conduit.mobile.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import media.conduit.mobile.DiscoverSelection
import media.conduit.mobile.LibrarySort
import media.conduit.mobile.MediaActionContext
import media.conduit.mobile.MediaActionSheet
import media.conduit.mobile.MediaActionTarget
import media.conduit.mobile.MobileCalendarScreen
import media.conduit.mobile.PlatformBackHandler
import media.conduit.mobile.RichPosterCard
import media.conduit.mobile.RichProgressCard
import media.conduit.mobile.TvShellModel
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.HomeCatalog
import media.conduit.mobile.account.discoverCatalogs
import media.conduit.mobile.asCatalogItem
import media.conduit.mobile.completionEpisodeIds
import media.conduit.mobile.focusRing
import media.conduit.mobile.foundation.AppAction
import media.conduit.mobile.foundation.AppDestination
import media.conduit.mobile.latestProgress
import media.conduit.mobile.latestUnfinishedProgress
import media.conduit.mobile.orderLibraryItems
import media.conduit.mobile.progressEpisodeUiKey
import media.conduit.mobile.progressHistoryForDisplay
import media.conduit.mobile.rememberWatchMetadataCache
import media.conduit.mobile.resolveDiscoverSelection
import media.conduit.mobile.typeLabel

private const val PosterColumns = 7

/** Focus ring, focus memory, and the Menu key for a shared poster or progress card. */
internal fun Modifier.tvTile(
    memory: TvFocusMemory,
    key: String,
    onMenu: () -> Unit,
    shape: Shape = RoundedCornerShape(12.dp),
    onFocused: () -> Unit = {},
): Modifier = tvRememberFocus(memory, key).tvMenuKey(onMenu).focusRing(shape, onFocused = onFocused)

/** A rail destination's page: a title row with its controls, then the content. */
@Composable
internal fun TvPage(
    title: String,
    controls: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(start = TvSpacing.Rail + 14.dp, top = TvSpacing.Edge, end = TvSpacing.Edge),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(end = 10.dp))
            controls()
        }
        content()
    }
}

@Composable
internal fun TvEmptyState(message: String) {
    Text(message, color = TvColors.Muted, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 24.dp))
}

/** A button showing the current value that opens a list of options. */
@Composable
internal fun TvPicker(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    selectedKey: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    var open by remember { mutableStateOf(false) }
    TvFocusable(
        onClick = { open = true },
        enabled = enabled && options.isNotEmpty(),
        shape = RoundedCornerShape(50),
        container = { focused -> if (focused) TvColors.ControlFocused else TvColors.Control },
        modifier = modifier,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, color = TvColors.Muted, style = MaterialTheme.typography.labelLarge, maxLines = 1)
            Text(value, color = if (enabled) Color.White else TvColors.Dim, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        }
    }
    if (open) {
        TvOptionDialog(
            title = label,
            options = options,
            selectedKey = selectedKey,
            onSelect = { key ->
                open = false
                onSelect(key)
            },
            onDismiss = { open = false },
        )
    }
}

/** A centered list of choices. The dialog window keeps D-pad focus inside until it closes. */
@Composable
internal fun TvOptionDialog(
    title: String,
    options: List<Pair<String, String>>,
    selectedKey: String?,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val initial = remember { FocusRequester() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        LaunchedEffect(Unit) { initial.requestFocusWhenReady() }
        Column(
            Modifier
                .width(360.dp)
                .heightIn(max = 440.dp)
                .background(Color(0xFF18181B), RoundedCornerShape(16.dp))
                .border(1.dp, TvColors.Hairline, RoundedCornerShape(16.dp))
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TvSectionLabel(title, Modifier.padding(start = 8.dp, top = 4.dp))
            val selectedIndex = options.indexOfFirst { it.first == selectedKey }.coerceAtLeast(0)
            LazyColumn(
                state = androidx.compose.foundation.lazy.rememberLazyListState(selectedIndex),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(options.size) { index ->
                    val (key, name) = options[index]
                    TvFocusable(
                        onClick = { onSelect(key) },
                        modifier = Modifier.fillMaxWidth().then(if (index == selectedIndex) Modifier.focusRequester(initial) else Modifier),
                    ) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(name, color = Color.White, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            if (key == selectedKey) Icon(Icons.Rounded.Check, "Selected", tint = TvColors.Amber, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

/** Catalog browsing with type, catalog, and genre filters, plus search across installed add-ons. */
@Composable
internal fun TvDiscover(model: TvShellModel, memory: TvFocusMemory) {
    val snapshot = model.sync.snapshot
    val addons = snapshot?.addons.orEmpty()
    val api = model.api
    val query = model.browseQuery
    val catalogs = remember(addons) { discoverCatalogs(addons) }
    val resolved = remember(catalogs, model.discoverSelection) { resolveDiscoverSelection(catalogs, model.discoverSelection) }
    val selected = resolved.catalog
    val genre = resolved.genre
    var results by remember(addons) { mutableStateOf<List<HomeCatalog>>(emptyList()) }
    var searchLoading by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf<List<CatalogItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(api, addons)
    val gridState = rememberLazyGridState()
    val tileSpec = androidx.compose.foundation.gestures.LocalBringIntoViewSpec.current

    LaunchedEffect(resolved.selection) {
        if (model.discoverSelection != resolved.selection) model.onDiscoverSelectionChange(resolved.selection)
    }
    LaunchedEffect(query, addons) {
        if (query.isBlank()) {
            results = emptyList()
            searchLoading = false
            return@LaunchedEffect
        }
        delay(350)
        searchLoading = true
        results = runCatching { api.searchCatalogs(addons, query.trim()) }.getOrDefault(emptyList())
        searchLoading = false
    }
    LaunchedEffect(selected, genre) {
        items = emptyList()
        error = null
        hasMore = true
        loadingMore = false
        if (selected == null) return@LaunchedEffect
        loading = true
        runCatching { api.loadCatalog(selected, genre) }
            .onSuccess { page -> items = page.distinctBy { "${it.type}:${it.id}" }; hasMore = page.isNotEmpty() }
            .onFailure { error = it.message ?: "Unable to load this catalog"; hasMore = false }
        loading = false
        gridState.scrollToItem(0)
    }

    TvPage("Discover", controls = {
        if (query.isBlank()) {
            resolved.types.forEach { type ->
                TvChip(
                    typeLabel(type),
                    selected = type == resolved.type,
                    onClick = { model.onDiscoverSelectionChange(DiscoverSelection(type = type)) },
                    modifier = Modifier.tvRememberFocus(memory, "type:$type"),
                )
            }
            TvPicker(
                label = "Catalog",
                value = selected?.name ?: "None",
                options = resolved.typeCatalogs.map { catalog ->
                    "${catalog.addonId}:${catalog.id}" to
                        if (resolved.typeCatalogs.count { it.name == catalog.name } > 1) "${catalog.name} · ${catalog.addonName}" else catalog.name
                },
                selectedKey = selected?.let { "${it.addonId}:${it.id}" },
                onSelect = { key ->
                    resolved.typeCatalogs.firstOrNull { "${it.addonId}:${it.id}" == key }?.let { next ->
                        model.onDiscoverSelectionChange(DiscoverSelection(next.addonId, resolved.type, next.id))
                    }
                },
                modifier = Modifier.tvRememberFocus(memory, "catalog"),
            )
            TvPicker(
                label = "Genre",
                value = genre ?: "All",
                options = buildList {
                    if (selected?.genreRequired != true) add("" to "All genres")
                    selected?.genres.orEmpty().forEach { add(it to it) }
                },
                selectedKey = genre.orEmpty(),
                enabled = selected?.supportsGenre == true,
                onSelect = { model.onDiscoverSelectionChange(resolved.selection.copy(genre = it.ifBlank { null })) },
                modifier = Modifier.tvRememberFocus(memory, "genre"),
            )
        }
        TvTextField(
            value = query,
            onValueChange = model.onBrowseQueryChange,
            label = "Search",
            placeholder = "Movies and series",
            imeAction = ImeAction.Search,
            modifier = Modifier.width(240.dp).tvRememberFocus(memory, "search"),
        )
    }) {
        val openActions = { item: CatalogItem ->
            actionTarget = MediaActionTarget(item, MediaActionContext.Browse, latestProgress(snapshot, item))
        }
        if (query.isNotBlank()) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(bottom = 60.dp)) {
                if (searchLoading && results.isEmpty()) item { TvEmptyState("Searching…") }
                if (!searchLoading && results.isEmpty()) item { TvEmptyState("No results for “$query”.") }
                results.forEach { catalog ->
                    item(key = "search:${catalog.key}:$query") {
                        TvRow(catalog.title, tileSpec) {
                            items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
                                RichPosterCard(
                                    item, item.releaseInfo ?: item.type, snapshot, metadataCache,
                                    onClick = { model.onOpenMedia(item, null) },
                                    onActions = { openActions(item) },
                                    modifier = Modifier.width(104.dp)
                                        .tvTile(memory, "search:${catalog.key}:${item.type}:${item.id}", onMenu = { openActions(item) }),
                                )
                            }
                        }
                    }
                }
            }
        } else when {
            loading -> TvEmptyState("Loading…")
            selected == null -> TvEmptyState("No discover catalogs available.")
            error != null -> TvEmptyState(error.orEmpty())
            items.isEmpty() -> TvEmptyState("This catalog returned no titles.")
            else -> LazyVerticalGrid(
                state = gridState,
                columns = GridCells.Fixed(PosterColumns),
                contentPadding = PaddingValues(top = 4.dp, bottom = 60.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(items, key = { "${it.type}:${it.id}" }) { item ->
                    RichPosterCard(
                        item, item.releaseInfo ?: typeLabel(item.type), snapshot, metadataCache,
                        onClick = { model.onOpenMedia(item, null) },
                        onActions = { openActions(item) },
                        modifier = Modifier.tvTile(memory, "grid:${item.type}:${item.id}", onMenu = { openActions(item) }),
                        showLabels = false,
                    )
                }
                if (hasMore) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        LaunchedEffect(items.size, selected, genre) {
                            if (loadingMore) return@LaunchedEffect
                            loadingMore = true
                            runCatching { api.loadCatalog(selected, genre, items.size) }
                                .onSuccess { page ->
                                    val known = items.mapTo(mutableSetOf()) { "${it.type}:${it.id}" }
                                    val next = page.filter { known.add("${it.type}:${it.id}") }
                                    items = items + next
                                    hasMore = page.isNotEmpty() && next.isNotEmpty()
                                }
                                .onFailure { hasMore = false }
                            loadingMore = false
                        }
                        Text("Loading more…", color = TvColors.Dim, modifier = Modifier.padding(vertical = 12.dp))
                    }
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = snapshot,
        metadataCache = metadataCache,
        onDismiss = { actionTarget = null },
        onPlay = { model.onOpenMedia(it.item, null) },
        onDetails = { model.onOpenMedia(it.item, null) },
        onMutation = model.onMutation,
    )
}

/** Saved titles with type and sort filters, plus the watch history and release calendar. */
@Composable
internal fun TvLibrary(model: TvShellModel, memory: TvFocusMemory, active: Boolean) {
    val snapshot = model.sync.snapshot
    if (model.state.destination == AppDestination.Calendar) {
        Box(Modifier.fillMaxSize().padding(start = TvSpacing.Rail, top = 8.dp, end = 14.dp)) {
            MobileCalendarScreen(
                snapshot = snapshot,
                api = model.api,
                active = active,
                onBack = { model.dispatch(AppAction.Navigate(AppDestination.Library)) },
                onSelect = model.onOpenMedia,
            )
        }
        return
    }
    var filter by remember { mutableStateOf("all") }
    var sort by remember { mutableStateOf(LibrarySort.LastWatched) }
    var historyOpen by remember { mutableStateOf(false) }
    var actionTarget by remember { mutableStateOf<MediaActionTarget?>(null) }
    val metadataCache = rememberWatchMetadataCache(model.api, snapshot?.addons.orEmpty())
    PlatformBackHandler(enabled = active && historyOpen, onBack = { historyOpen = false })
    // The button that switched views is gone afterwards, so focus moves to its counterpart.
    var historyToggled by remember { mutableStateOf(false) }
    LaunchedEffect(historyOpen) {
        if (!historyToggled && !historyOpen) return@LaunchedEffect
        historyToggled = true
        memory.key = if (historyOpen) "history-back" else "history"
        androidx.compose.runtime.withFrameNanos { }
        memory.restore()
    }

    if (historyOpen) {
        val history = progressHistoryForDisplay(snapshot?.history.orEmpty())
        TvPage("Watch history", controls = {
            TvButton("Library", onClick = { historyOpen = false }, modifier = Modifier.tvRememberFocus(memory, "history-back"))
        }) {
            if (history.isEmpty()) TvEmptyState("Nothing watched yet.") else LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                contentPadding = PaddingValues(top = 4.dp, bottom = 60.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(history, key = ::progressEpisodeUiKey) { progress ->
                    val item = CatalogItem(progress.mediaId, progress.mediaType, progress.name, poster = progress.poster)
                    val openActions = { actionTarget = MediaActionTarget(item, MediaActionContext.History, progress) }
                    RichProgressCard(
                        progress = progress,
                        onClick = { model.onOpenMedia(item, progress.videoId) },
                        onActions = openActions,
                        modifier = Modifier.tvTile(memory, "history:${progressEpisodeUiKey(progress)}", onMenu = openActions),
                    )
                }
            }
        }
    } else {
        val filtered = snapshot?.library.orEmpty().filter { filter == "all" || it.type == filter }
        val statusSort = sort == LibrarySort.Watched || sort == LibrarySort.NotWatched
        val statusKey = if (statusSort) {
            filtered.joinToString(prefix = sort.name, separator = "|") { "${it.type}:${it.id}:${it.updatedAt}" }
        } else {
            null
        }
        var preparedStatusKey by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(statusKey, metadataCache) {
            if (statusKey == null) {
                preparedStatusKey = null
                return@LaunchedEffect
            }
            // Watched-state ordering needs each series' episode list first.
            coroutineScope { filtered.forEach { item -> launch { metadataCache.load(item.asCatalogItem()) } } }
            preparedStatusKey = statusKey
        }
        val ordered = orderLibraryItems(filtered, snapshot?.progress.orEmpty(), sort) { item ->
            completionEpisodeIds(metadataCache.videosFor(item.asCatalogItem()))
        }
        TvPage("Library", controls = {
            listOf("all" to "All", "movie" to "Movies", "series" to "Series").forEach { (key, label) ->
                TvChip(label, selected = filter == key, onClick = { filter = key }, modifier = Modifier.tvRememberFocus(memory, "filter:$key"))
            }
            TvPicker(
                label = "Sort",
                value = sort.label,
                options = LibrarySort.entries.map { it.name to it.label },
                selectedKey = sort.name,
                onSelect = { key -> LibrarySort.entries.firstOrNull { it.name == key }?.let { sort = it } },
                modifier = Modifier.tvRememberFocus(memory, "sort"),
            )
            TvButton("History", onClick = { historyOpen = true }, icon = Icons.Rounded.History, modifier = Modifier.tvRememberFocus(memory, "history"))
            TvButton(
                "Calendar",
                onClick = { model.dispatch(AppAction.Navigate(AppDestination.Calendar)) },
                icon = Icons.Rounded.CalendarMonth,
                modifier = Modifier.tvRememberFocus(memory, "calendar"),
            )
        }) {
            when {
                snapshot == null -> TvEmptyState("Loading…")
                statusKey != null && preparedStatusKey != statusKey -> TvEmptyState("Loading…")
                ordered.isEmpty() -> TvEmptyState("Nothing saved here yet.")
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(PosterColumns),
                    contentPadding = PaddingValues(top = 4.dp, bottom = 60.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(ordered, key = { "${it.type}:${it.id}" }) { saved ->
                        val item = saved.asCatalogItem()
                        val openActions = { actionTarget = MediaActionTarget(item, MediaActionContext.Library, latestProgress(snapshot, item)) }
                        RichPosterCard(
                            item, saved.type, snapshot, metadataCache,
                            onClick = { model.onResume(item, latestUnfinishedProgress(snapshot.progress, item)?.videoId) },
                            onActions = openActions,
                            modifier = Modifier.tvTile(memory, "library:${item.type}:${item.id}", onMenu = openActions),
                            showLabels = false,
                        )
                    }
                }
            }
        }
    }
    MediaActionSheet(
        target = actionTarget,
        snapshot = snapshot,
        metadataCache = metadataCache,
        onDismiss = { actionTarget = null },
        onPlay = { model.onOpenMedia(it.item, it.progress?.videoId) },
        onDetails = { model.onOpenMedia(it.item, null) },
        onMutation = model.onMutation,
    )
}
