package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.booleanOrNull
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.*

private val VideoItem.displayTitle: String
    get() = title?.takeIf(String::isNotBlank)
        ?: name?.takeIf(String::isNotBlank)
        ?: overview?.lineSequence()?.firstOrNull()?.take(80)?.takeIf(String::isNotBlank)
        ?: "Episode ${episode ?: ""}".trim()

@Composable
internal fun MobileLibraryScreen(
    snapshot: ProfileSnapshot?,
    onSelect: (CatalogItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    var filter by remember { mutableStateOf("all") }
    var sortNewest by remember { mutableStateOf(true) }
    val items = snapshot?.library.orEmpty()
        .filter { filter == "all" || it.type == filter }
        .let { if (sortNewest) it.sortedByDescending(LibraryItemSummary::updatedAt) else it.sortedBy(LibraryItemSummary::name) }

    Column(modifier.statusBarsPadding()) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Library", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
            Text("Your saved movies and series", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("all" to "All", "movie" to "Movies", "series" to "Series").forEach { (value, label) ->
                    FilterChip(selected = filter == value, onClick = { filter = value }, label = { Text(label) })
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { sortNewest = !sortNewest }) {
                    Icon(if (sortNewest) Icons.Rounded.Schedule else Icons.Rounded.SortByAlpha, "Change sort")
                }
            }
        }
        if (snapshot == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text("Nothing saved here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 112.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(items, key = { "${it.type}:${it.id}" }) { item ->
                    MediaPoster(item.name, item.poster, item.type) {
                        onSelect(CatalogItem(item.id, item.type, item.name, poster = item.poster))
                    }
                }
            }
        }
    }
}

@Composable
internal fun SearchDiscoverScreen(
    addons: List<InstalledAddonSummary>,
    api: ConduitApi,
    onSelect: (CatalogItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf("") }
    var results by remember(addons) { mutableStateOf<List<CatalogItem>>(emptyList()) }
    var discover by remember(addons) { mutableStateOf<List<CatalogItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    LaunchedEffect(addons) {
        discover = runCatching { api.loadHomeCatalogs(addons).catalogs.flatMap { it.items }.distinctBy { "${it.type}:${it.id}" } }.getOrDefault(emptyList())
    }
    LaunchedEffect(query, addons) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(350)
        loading = true
        results = runCatching { api.searchCatalogs(addons, query.trim()) }.getOrDefault(emptyList())
        loading = false
    }
    val visible = if (query.isBlank()) discover else results
    LazyColumn(
        modifier = modifier.statusBarsPadding(),
        contentPadding = PaddingValues(bottom = 112.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Text(
                "Search", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp),
            )
        }
        stickyHeader {
            Column(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background.copy(alpha = .97f))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Movies, series, and episodes") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = if (query.isNotBlank()) {{ IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, "Clear") } }} else null,
                    singleLine = true, shape = RoundedCornerShape(18.dp),
                )
                Text(if (query.isBlank()) "Discover" else "Results", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            }
        }
        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (!loading && visible.isEmpty()) {
            item {
                Box(Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) {
                    Text(if (query.isBlank()) "No discover catalogs available." else "No results for “$query”.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            visible.chunked(3).forEachIndexed { rowIndex, rowItems ->
                item(key = "search-row-$rowIndex-${query}") {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        rowItems.forEach { item ->
                            Box(Modifier.weight(1f)) {
                                MediaPoster(item.name, item.poster, item.releaseInfo ?: item.type) { onSelect(item) }
                            }
                        }
                        repeat(3 - rowItems.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MediaPoster(name: String, poster: String?, caption: String, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        AsyncImage(
            model = poster, contentDescription = name, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        )
        Text(name, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        Text(caption.replaceFirstChar(Char::uppercase), maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
    }
}

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
    onProgressChanged: () -> Unit,
    onBack: () -> Unit,
) {
    var meta by remember(item.id, item.type) { mutableStateOf<MetaItem?>(null) }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    var selectedVideo by remember(item.id) { mutableStateOf<VideoItem?>(null) }
    var streams by remember(item.id) { mutableStateOf<List<StreamSource>?>(null) }
    var streamPageOpen by remember(item.id) { mutableStateOf(false) }
    var streamsLoading by remember(item.id) { mutableStateOf(false) }
    var streamsError by remember(item.id) { mutableStateOf<String?>(null) }
    var playing by remember(item.id) { mutableStateOf<StreamItem?>(null) }
    var playback by remember(item.id) { mutableStateOf(PlaybackState()) }
    var resumePosition by remember(item.id) { mutableStateOf(0L) }
    var episodesOpen by remember(item.id) { mutableStateOf(false) }
    var currentAddonName by remember(item.id) { mutableStateOf<String?>(null) }
    var externalSubtitles by remember(item.id) { mutableStateOf<List<SubtitleItem>>(emptyList()) }
    var selectedSeason by remember(item.id) { mutableStateOf<Int?>(null) }
    val detailsSeasonListState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(item.id, item.type, addons) {
        runCatching { api.loadMeta(addons, item.type, item.id) }
            .onSuccess {
                meta = it
                selectedVideo = it.videos.firstOrNull { video -> video.id == initialVideoId }
                    ?: it.videos.firstOrNull()
            }.onFailure { error = it.message }
    }
    fun requestStreams(video: VideoItem? = selectedVideo) {
        streamPageOpen = true
        streamsLoading = true
        streamsError = null
        val videoId = video?.id ?: item.id
        streams = null
        scope.launch {
            runCatching { api.loadStreams(addons, item.type, videoId) }
                .onSuccess { streams = it }
                .onFailure { streamsError = it.message ?: "Unable to load streams" }
            streamsLoading = false
        }
    }
    val playingVideoId = selectedVideo?.id ?: item.id
    LaunchedEffect(playingVideoId, addons) { externalSubtitles = runCatching { api.loadSubtitles(addons, item.type, playingVideoId) }.getOrDefault(emptyList()) }
    LaunchedEffect(playingVideoId, profile?.id) {
        resumePosition = snapshot?.progress?.firstOrNull { it.videoId == playingVideoId }?.takeUnless { it.watched }?.positionMs
            ?: profile?.let { runCatching { api.loadProgress(baseUrl, token, it.id, playingVideoId) }.getOrNull()?.takeUnless { progress -> progress.watched }?.positionMs }
            ?: 0L
    }
    suspend fun persistProgress() {
        val activeProfile = profile ?: return
        val video = selectedVideo
        api.saveProgress(baseUrl, token, activeProfile.id, video?.id ?: item.id, item.type, item.id,
            meta?.name ?: item.name, meta?.poster ?: item.poster, video?.displayTitle, video?.season, video?.episode,
            playback.positionMs, playback.durationMs)
        onProgressChanged()
    }
    fun playNext(video: VideoItem) {
        val preferredAddon = currentAddonName
        scope.launch {
            runCatching { persistProgress() }
            selectedVideo = video
            resumePosition = 0L
            streamsLoading = true
            val choices = runCatching { api.loadStreams(addons, item.type, video.id) }.getOrDefault(emptyList())
            streamsLoading = false
            val choice = choices.firstOrNull { it.addonName == preferredAddon && it.stream.url != null }
                ?: choices.firstOrNull { it.stream.url != null }
            if (choice != null) {
                currentAddonName = choice.addonName
                playing = choice.stream
            } else {
                streams = choices
                streamsError = if (choices.isEmpty()) "No streams were returned for the next episode." else null
                streamPageOpen = true
                playing = null
            }
        }
    }
    PlatformBackHandler {
        when {
            playing != null -> scope.launch { runCatching { persistProgress() }; playing = null }
            streamPageOpen -> { streamPageOpen = false; streams = null }
            else -> onBack()
        }
    }
    LaunchedEffect(playing, playingVideoId) {
        while (playing != null) { delay(15_000); runCatching { persistProgress() } }
    }
    val orderedVideos = meta?.videos.orEmpty().sortedWith(compareBy<VideoItem> { it.season ?: 0 }.thenBy { it.episode ?: 0 })
    val nextVideo = orderedVideos.indexOfFirst { it.id == selectedVideo?.id }.takeIf { it >= 0 }?.let { orderedVideos.getOrNull(it + 1) }
    LaunchedEffect(playback.ended) { if (playback.ended) runCatching { persistProgress() } }

    if (playing?.url != null) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            NativePlayer(
                url = playing!!.url!!, active = true, startPositionMs = resumePosition,
                requestHeaders = playing!!.behaviorHints?.proxyHeaders?.request.orEmpty().mapNotNull { (key, value) -> value.jsonPrimitive.contentOrNull?.let { key to it } }.toMap(),
                subtitles = externalSubtitles,
                hasEpisodes = orderedVideos.isNotEmpty(), onEpisodes = { episodesOpen = true }, modifier = Modifier.fillMaxSize(),
            ) { playback = it }
            IconButton(onClick = { scope.launch { runCatching { persistProgress() }; playing = null } }, modifier = Modifier.statusBarsPadding().padding(12.dp).background(Color.Black.copy(.55f), CircleShape).align(Alignment.TopStart)) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White) }
            if (playback.loading && playback.error == null) CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
            playback.error?.let { message -> Box(Modifier.matchParentSize().background(Color.Black.copy(.72f)).clickable(enabled = true, onClick = {}), contentAlignment = Alignment.Center) { Surface(color = Color(0xF21A1A1D), shape = RoundedCornerShape(18.dp), modifier = Modifier.padding(28.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(.45f))) { Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Rounded.ErrorOutline, null, tint = MaterialTheme.colorScheme.error); Spacer(Modifier.height(8.dp)); Text("Playback failed", color = Color.White, fontWeight = FontWeight.Bold); Text(message, color = Color.White.copy(.7f), style = MaterialTheme.typography.bodySmall); Spacer(Modifier.height(14.dp)); Button(onClick = { playing = null }) { Text("Choose another stream") } } } } }
            if (!episodesOpen && nextVideo != null && playback.durationMs > 0 && playback.durationMs - playback.positionMs in 1..30_000) {
                Surface(Modifier.align(Alignment.BottomEnd).padding(end = 24.dp, bottom = 118.dp).widthIn(min = 360.dp, max = 480.dp), color = Color(0xE619191B), shape = RoundedCornerShape(22.dp), border = BorderStroke(1.dp, Color.White.copy(.16f)), shadowElevation = 18.dp) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) { AsyncImage(nextVideo.thumbnail ?: meta?.background, null, Modifier.size(112.dp, 68.dp).clip(RoundedCornerShape(13.dp)), contentScale = ContentScale.Crop); Spacer(Modifier.width(14.dp)); Column(Modifier.weight(1f)) { Text("NEXT EPISODE", color = Color.White.copy(.6f), style = MaterialTheme.typography.labelSmall); Text("S${nextVideo.season ?: 0}E${nextVideo.episode ?: 0} · ${nextVideo.displayTitle}", color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }; OutlinedButton(onClick = { playNext(nextVideo) }, border = BorderStroke(1.dp, Color.White.copy(.35f))) { Icon(Icons.Rounded.PlayArrow, null); Spacer(Modifier.width(4.dp)); Text("Play") } }
                }
            }
            if (episodesOpen) PlayerEpisodeDrawer(orderedVideos, selectedVideo, snapshot, onDismiss = { episodesOpen = false }) { video ->
                episodesOpen = false
                scope.launch { runCatching { persistProgress() }; selectedVideo = video; playing = null; requestStreams(video) }
            }
        }
        return
    }
    if (streamPageOpen) {
        StreamSelectionScreen(meta?.name ?: item.name, meta?.background ?: meta?.poster ?: item.background ?: item.poster, selectedVideo, streams.orEmpty(), streamsLoading, streamsError, onBack = { streamPageOpen = false; streams = null }) { source ->
            if (source.stream.url != null) { currentAddonName = source.addonName; playing = source.stream }
        }
        return
    }

    val details = meta
    val seriesProgress = snapshot?.progress.orEmpty().filter { it.mediaId == item.id && !it.watched }.maxByOrNull { it.updatedAt }
    val resumeVideo = details?.videos?.firstOrNull { it.id == seriesProgress?.videoId }
    LaunchedEffect(details?.id, resumeVideo?.season) { if (selectedSeason == null) selectedSeason = resumeVideo?.season ?: details?.videos?.firstOrNull()?.season }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(if (item.type == "movie") 390.dp else 350.dp)) {
                AsyncImage(
                    model = details?.background ?: item.background ?: details?.poster ?: item.poster,
                    contentDescription = item.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                )
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(.15f), MaterialTheme.colorScheme.background))))
                IconButton(onClick = onBack, modifier = Modifier.statusBarsPadding().padding(12.dp).background(Color.Black.copy(.5f), CircleShape)) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White)
                }
                Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(details?.name ?: item.name, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Text(
                        listOfNotNull(details?.releaseInfo, details?.runtime, details?.imdbRating?.let { "★ $it" }).joinToString("  ·  "),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (details == null && error == null) CircularProgressIndicator()
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(onClick = { val target = resumeVideo ?: selectedVideo; selectedVideo = target; requestStreams(target) }, modifier = Modifier.fillMaxWidth().height(54.dp)) {
                    Icon(Icons.Rounded.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text(if (resumeVideo != null) "Resume S${resumeVideo.season ?: 0}E${resumeVideo.episode ?: 0}" else "Play")
                }
                details?.genres?.takeIf { it.isNotEmpty() }?.let { genres ->
                    Text(genres.joinToString("  ·  "), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                }
                details?.description?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge) }
                if (item.type == "movie") details?.cast?.takeIf { it.isNotEmpty() }?.let { cast ->
                    Text("Cast", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) { items(cast.take(10)) { person -> Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(76.dp)) { Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(68.dp)) { Box(contentAlignment = Alignment.Center) { Text(person.split(' ').mapNotNull { it.firstOrNull() }.take(2).joinToString(""), fontWeight = FontWeight.Bold) } }; Text(person, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall) } } }
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
                            Surface(onClick = { selectedVideo = video; requestStreams(video) }, modifier = Modifier.width(260.dp), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(.65f)) {
                                Column { Box { AsyncImage(video.thumbnail ?: details.background, null, Modifier.fillMaxWidth().height(142.dp), contentScale = ContentScale.Crop); Surface(Modifier.padding(8.dp), color = Color.Black.copy(.65f), shape = RoundedCornerShape(8.dp)) { Text("S${video.season ?: 0}E${video.episode ?: 0}", color = Color.White, modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall) } }; Column(Modifier.padding(12.dp)) { Text(video.displayTitle, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); (video.overview ?: video.description)?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }; if (progress != null && progress.durationMs > 0) LinearProgressIndicator({ progress.positionMs.toFloat() / progress.durationMs }, Modifier.fillMaxWidth().padding(top = 8.dp), color = MaterialTheme.colorScheme.primary) } }
                            }
                        }
                    }
                }
            }
        }
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

@Composable
private fun StreamSelectionScreen(
    title: String,
    artwork: String?,
    episode: VideoItem?,
    streams: List<StreamSource>,
    loading: Boolean,
    error: String?,
    onBack: () -> Unit,
    onSelect: (StreamSource) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        artwork?.let { Box(Modifier.fillMaxWidth().height(150.dp)) { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop); Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(.12f), MaterialTheme.colorScheme.background)))) } }
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Column { Text("Choose a stream", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(listOfNotNull(title, episode?.let { "S${it.season ?: 0}E${it.episode ?: 0} · ${it.displayTitle}" }).joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (loading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) { CircularProgressIndicator(); Text("Finding streams…", color = MaterialTheme.colorScheme.onSurfaceVariant) } }
        else if (error != null) Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) { Text(error, color = MaterialTheme.colorScheme.error) }
        else if (streams.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No streams were returned.") }
        else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(streams) { source ->
                Surface(
                    color = Color.White.copy(alpha = .05f), shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().clickable(enabled = source.stream.url != null) { onSelect(source) },
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(source.stream.name ?: source.stream.title ?: "Stream", fontWeight = FontWeight.Bold)
                            source.stream.description?.let { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            Text(source.addonName, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
                        }
                        Icon(if (source.stream.url != null) Icons.Rounded.PlayArrow else Icons.Rounded.Link, null)
                    }
                }
            }
        }
    }
}

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
    modifier: Modifier = Modifier,
) {
    var route by remember { mutableStateOf<ProfileRoute>(ProfileRoute.Settings) }
    LaunchedEffect(route) { onProfileFlowChanged(route != ProfileRoute.Settings) }
    DisposableEffect(Unit) { onDispose { onProfileFlowChanged(false) } }
    when (val current = route) {
        ProfileRoute.Overview -> return ProfileOverviewScreen(activeProfile, profileSync.snapshot, { route = ProfileRoute.Settings }, { route = ProfileRoute.Switcher }, { activeProfile?.let { route = ProfileRoute.Edit(it) } }, modifier)
        ProfileRoute.Switcher -> return ProfileSwitcherScreen(account.bootstrap.households.flatMap { it.profiles }, activeProfile, { route = ProfileRoute.Overview }, { route = ProfileRoute.Edit(it) }, { route = ProfileRoute.Create }, { dispatch(AppAction.SelectProfile(it.id)); route = ProfileRoute.Overview }, modifier)
        ProfileRoute.Create -> return ProfileEditorScreen(null, activeProfile, api, state, account, { route = ProfileRoute.Switcher }, onProfilesChanged, modifier)
        is ProfileRoute.Edit -> return ProfileEditorScreen(current.profile, activeProfile, api, state, account, { route = ProfileRoute.Overview }, onProfilesChanged, modifier)
        ProfileRoute.Addons -> return AddonManagerScreen(activeProfile, profileSync.snapshot?.addons.orEmpty(), api, state, account, { route = ProfileRoute.Settings }, onProfileDataChanged, modifier)
        ProfileRoute.Settings -> Unit
    }
    val sections = listOf(
        SettingSection("Account", listOf(
            SettingEntry("Profile", "Profiles, appearance, and viewing overview", Icons.Rounded.AccountCircle),
            SettingEntry("Account", "Sign-in, security, and recovery", Icons.Rounded.Person),
        )),
        SettingSection("General", listOf(
            SettingEntry("General", "Appearance and layout", Icons.Rounded.Tune),
            SettingEntry("Content & discovery", "Add-ons, catalogs, and search", Icons.Rounded.Explore),
            SettingEntry("Add-ons", "Install and manage content providers", Icons.Rounded.Extension),
            SettingEntry("Downloads", "Offline media and storage", Icons.Rounded.Download),
            SettingEntry("Playback", "Player, subtitles, and behavior", Icons.Rounded.PlayCircle),
            SettingEntry("Integrations", "Connected media services", Icons.Rounded.Extension),
            SettingEntry("Notifications", "Episode and app alerts", Icons.Rounded.Notifications),
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
    var settingsQuery by remember { mutableStateOf("") }
    val visibleSections = sections.mapNotNull { section ->
        val query = settingsQuery.trim()
        val entries = section.entries.filter { query.isBlank() || "${section.title} ${it.title} ${it.description}".contains(query, ignoreCase = true) }
        entries.takeIf { it.isNotEmpty() }?.let { SettingSection(section.title, it) }
    }
    LazyColumn(
        modifier.statusBarsPadding(),
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
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { when (entry.title) { "Profile" -> route = ProfileRoute.Overview; "Add-ons" -> route = ProfileRoute.Addons } },
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

private sealed interface ProfileRoute {
    data object Settings : ProfileRoute
    data object Overview : ProfileRoute
    data object Switcher : ProfileRoute
    data object Create : ProfileRoute
    data object Addons : ProfileRoute
    data class Edit(val profile: ProfileSummary) : ProfileRoute
}

@Composable
private fun ProfileHeader(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
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
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = 130.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ProfileHeader("Profile", onBack) }
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
    val scope = rememberCoroutineScope(); var name by remember { mutableStateOf(profile?.name.orEmpty()) }; var kids by remember { mutableStateOf(profile?.isKids ?: false) }; var color by remember { mutableStateOf(profile?.avatarColor ?: "#FFC107") }; var url by remember { mutableStateOf(profile?.avatarUrl.orEmpty()) }; var saving by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    val colors = listOf("#FFC107", "#FF8F00", "#E53935", "#8E24AA", "#3949AB", "#039BE5", "#00897B", "#43A047")
    val primary = account.bootstrap.households.firstOrNull { household -> household.profiles.any { it.id == (profile?.id ?: active?.id) } }?.profiles?.firstOrNull()
    val canUsePrimary = profile == null || profile.id != primary?.id
    var usesPrimaryAddons by remember { mutableStateOf(profile?.usesPrimaryAddons ?: false) }
    val preview = ProfileSummary(profile?.id ?: "new", name.ifBlank { "P" }, kids, usesPrimaryAddons, color, url.trim().ifBlank { null })
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = 130.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ProfileHeader(if (profile == null) "Add Profile" else "Edit Profile", onBack) }
        item { Column(Modifier.padding(horizontal = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) { ProfileAvatar(preview, 104); Spacer(Modifier.height(10.dp)); Text(name.ifBlank { "New profile" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Profile name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Kids profile", fontWeight = FontWeight.Medium); Text("Use a child-friendly profile", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(kids, { kids = it }) }
            if (canUsePrimary) Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Use primary add-ons", fontWeight = FontWeight.Medium); Text("Share ${primary?.name ?: "the primary profile"}'s live add-on setup", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(usesPrimaryAddons, { usesPrimaryAddons = it }) }
        } } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Text("Profile color", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { colors.forEach { option -> Surface(shape = CircleShape, color = profileColor(option), border = if (color == option) BorderStroke(3.dp, Color.White) else null, modifier = Modifier.size(36.dp).clickable { color = option }) {} } } } } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("Custom avatar URL", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Optional HTTPS image link. Leave empty to use your profile color.", color = MaterialTheme.colorScheme.onSurfaceVariant); OutlinedTextField(url, { url = it }, placeholder = { Text("https://example.com/avatar.png") }, singleLine = true, modifier = Modifier.fillMaxWidth()) } } }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 18.dp)) } }
        item { Button(onClick = { scope.launch { saving = true; error = null; runCatching { val endpoint = requireNotNull(state.endpoint); val cleanUrl = url.trim().ifBlank { null }; require(cleanUrl == null || cleanUrl.startsWith("https://") || cleanUrl.startsWith("http://")) { "Avatar URL must begin with http:// or https://" }; require(name.isNotBlank()) { "Enter a profile name" }; if (profile == null) { val household = account.bootstrap.households.first(); api.createProfile(endpoint.baseUrl, account.session.token, household.id, name, kids, usesPrimaryAddons, color, cleanUrl) } else api.updateProfile(endpoint.baseUrl, account.session.token, profile.id, name, kids, usesPrimaryAddons, color, cleanUrl) }.onSuccess { onSaved(it.id); onBack() }.onFailure { error = it.message ?: "Unable to save profile" }; saving = false } }, enabled = !saving, modifier = Modifier.padding(horizontal = 10.dp).fillMaxWidth().height(54.dp)) { if (saving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (profile == null) "Create profile" else "Save changes") } }
    }
}

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
    fun runMutation(block: suspend (String, String, String) -> Unit) {
        val endpoint = state.endpoint ?: return
        val profileId = profile?.id ?: return
        scope.launch {
            busy = true; error = null
            runCatching {
                block(endpoint.baseUrl, account.session.token, profileId)
                addons = api.synchronizeProfile(endpoint.baseUrl, account.session.token, profileId).addons
                onChanged()
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
    LazyColumn(modifier, contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ProfileHeader("Add-ons", onBack) }
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
                Button(onClick = { val url = manifestUrl; runMutation { base, token, id -> api.installAddon(base, token, id, url) }; manifestUrl = "" }, enabled = !busy && manifestUrl.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(if (busy) "Verifying…" else "Install add-on") }
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

@Composable private fun AddonSectionLabel(text: String) { Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, start = 2.dp)) }
@Composable private fun AddonBadge(text: String) { Surface(color = Color.White.copy(.06f), shape = RoundedCornerShape(50)) { Text(text, Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }

private data class SettingEntry(val title: String, val description: String, val icon: ImageVector)
private data class SettingSection(val title: String, val entries: List<SettingEntry>)
