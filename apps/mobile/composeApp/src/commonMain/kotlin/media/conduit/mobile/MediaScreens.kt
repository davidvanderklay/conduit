package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.*

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
    onBack: () -> Unit,
) {
    var meta by remember(item.id, item.type) { mutableStateOf<MetaItem?>(null) }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    var selectedVideo by remember(item.id) { mutableStateOf<VideoItem?>(null) }
    var streams by remember(item.id) { mutableStateOf<List<StreamSource>?>(null) }
    var playing by remember(item.id) { mutableStateOf<StreamItem?>(null) }
    val scope = rememberCoroutineScope()
    PlatformBackHandler {
        when {
            playing != null -> playing = null
            streams != null -> streams = null
            else -> onBack()
        }
    }
    LaunchedEffect(item.id, item.type, addons) {
        runCatching { api.loadMeta(addons, item.type, item.id) }
            .onSuccess {
                meta = it
                selectedVideo = it.videos.firstOrNull { video -> video.id == initialVideoId }
                    ?: it.videos.firstOrNull()
            }.onFailure { error = it.message }
    }
    fun requestStreams(video: VideoItem? = selectedVideo) {
        val videoId = video?.id ?: item.id
        streams = null
        scope.launch { streams = api.loadStreams(addons, item.type, videoId) }
    }

    if (playing?.url != null) {
        Column(Modifier.fillMaxSize().background(Color.Black)) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { playing = null }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White) }
                Text(meta?.name ?: item.name, color = Color.White, fontWeight = FontWeight.SemiBold)
            }
            NativePlayer(playing!!.url!!, true, Modifier.fillMaxWidth().aspectRatio(16f / 9f)) { }
        }
        return
    }
    if (streams != null) {
        StreamSelectionScreen(meta?.name ?: item.name, streams.orEmpty(), onBack = { streams = null }) { source ->
            if (source.stream.url != null) playing = source.stream
        }
        return
    }

    val details = meta
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(310.dp)) {
                AsyncImage(
                    model = details?.background ?: item.background ?: details?.poster ?: item.poster,
                    contentDescription = item.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                )
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(.15f), MaterialTheme.colorScheme.background))))
                IconButton(onClick = onBack, modifier = Modifier.statusBarsPadding().padding(12.dp).background(Color.Black.copy(.5f), CircleShape)) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White)
                }
                Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 20.dp)) {
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
                Button(onClick = { requestStreams() }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Rounded.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text("Choose stream")
                }
                details?.genres?.takeIf { it.isNotEmpty() }?.let { genres ->
                    Text(genres.joinToString("  ·  "), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                }
                details?.description?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge) }
                details?.cast?.takeIf { it.isNotEmpty() }?.let { Text("Cast\n${it.take(8).joinToString(", ")}") }
            }
        }
        details?.videos?.takeIf { it.isNotEmpty() }?.let { videos ->
            item { Text("Episodes", modifier = Modifier.padding(20.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
            items(videos, key = VideoItem::id) { video ->
                ListItem(
                    headlineContent = { Text(video.title ?: "Episode ${video.episode ?: ""}") },
                    supportingContent = { Text(listOfNotNull(video.season?.let { "S$it" }, video.episode?.let { "E$it" }).joinToString(" · ")) },
                    leadingContent = { AsyncImage(video.thumbnail, null, Modifier.size(96.dp, 58.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop) },
                    trailingContent = { Icon(Icons.Rounded.PlayArrow, null) },
                    modifier = Modifier.clickable { selectedVideo = video; requestStreams(video) },
                )
            }
        }
    }
}

@Composable
private fun StreamSelectionScreen(
    title: String,
    streams: List<StreamSource>,
    onBack: () -> Unit,
    onSelect: (StreamSource) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Column { Text("Choose a stream", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (streams.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No streams were returned.") }
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
        ProfileRoute.Settings -> Unit
    }
    val sections = listOf(
        SettingEntry("Account", "Sign-in, security, and recovery", Icons.Rounded.Person),
        SettingEntry("General", "Appearance and layout", Icons.Rounded.Tune),
        SettingEntry("Content & discovery", "Add-ons, catalogs, and search", Icons.Rounded.Explore),
        SettingEntry("Downloads", "Offline media and storage", Icons.Rounded.Download),
        SettingEntry("Playback", "Player, subtitles, and behavior", Icons.Rounded.PlayCircle),
        SettingEntry("Integrations", "Connected media services", Icons.Rounded.Extension),
        SettingEntry("Notifications", "Episode and app alerts", Icons.Rounded.Notifications),
        SettingEntry("Supporters & contributors", "Community and open source", Icons.Rounded.Favorite),
        SettingEntry("Privacy policy", "Data and privacy details", Icons.Rounded.PrivacyTip),
        SettingEntry("Advanced settings", "Server and diagnostics", Icons.Rounded.SettingsSuggest),
    )
    var settingsQuery by remember { mutableStateOf("") }
    val visibleSections = sections.filter {
        settingsQuery.isBlank() || "${it.title} ${it.description}".contains(settingsQuery.trim(), ignoreCase = true)
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
        item {
            Text("Switch profile", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                account.bootstrap.households.flatMap { it.profiles }.forEach { profile ->
                    FilterChip(selected = profile.id == activeProfile?.id, onClick = { dispatch(AppAction.SelectProfile(profile.id)) }, label = { Text(profile.name) })
                }
            }
        }
        items(visibleSections) { entry ->
            ListItem(
                headlineContent = { Text(entry.title, fontWeight = FontWeight.Medium) },
                supportingContent = { Text(entry.description) },
                leadingContent = { Icon(entry.icon, null, tint = MaterialTheme.colorScheme.primary) },
                trailingContent = { Icon(Icons.Rounded.ChevronRight, null) },
                colors = ListItemDefaults.colors(containerColor = Color.White.copy(alpha = .035f)),
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { },
            )
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
    val scope = rememberCoroutineScope(); var name by remember { mutableStateOf(profile?.name.orEmpty()) }; var kids by remember { mutableStateOf(profile?.isKids ?: false) }; var color by remember { mutableStateOf(profile?.avatarColor ?: "#FFC107") }; var url by remember { mutableStateOf(profile?.avatarUrl.orEmpty()) }; var copyAddons by remember { mutableStateOf(profile == null) }; var saving by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    val colors = listOf("#FFC107", "#FF8F00", "#E53935", "#8E24AA", "#3949AB", "#039BE5", "#00897B", "#43A047")
    val preview = ProfileSummary(profile?.id ?: "new", name.ifBlank { "P" }, kids, color, url.trim().ifBlank { null })
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = 130.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ProfileHeader(if (profile == null) "Add Profile" else "Edit Profile", onBack) }
        item { Column(Modifier.padding(horizontal = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) { ProfileAvatar(preview, 104); Spacer(Modifier.height(10.dp)); Text(name.ifBlank { "New profile" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Profile name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Kids profile", fontWeight = FontWeight.Medium); Text("Use a child-friendly profile", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(kids, { kids = it }) }
            if (profile == null) Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Copy current add-ons", fontWeight = FontWeight.Medium); Text("Start with ${active?.name ?: "this profile"}'s add-ons", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(copyAddons, { copyAddons = it }) }
        } } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Text("Profile color", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { colors.forEach { option -> Surface(shape = CircleShape, color = profileColor(option), border = if (color == option) BorderStroke(3.dp, Color.White) else null, modifier = Modifier.size(36.dp).clickable { color = option }) {} } } } } }
        item { Card(Modifier.padding(horizontal = 10.dp).fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("Custom avatar URL", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Optional HTTPS image link. Leave empty to use your profile color.", color = MaterialTheme.colorScheme.onSurfaceVariant); OutlinedTextField(url, { url = it }, placeholder = { Text("https://example.com/avatar.png") }, singleLine = true, modifier = Modifier.fillMaxWidth()) } } }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 18.dp)) } }
        item { Button(onClick = { scope.launch { saving = true; error = null; runCatching { val endpoint = requireNotNull(state.endpoint); val cleanUrl = url.trim().ifBlank { null }; require(cleanUrl == null || cleanUrl.startsWith("https://") || cleanUrl.startsWith("http://")) { "Avatar URL must begin with http:// or https://" }; require(name.isNotBlank()) { "Enter a profile name" }; if (profile == null) { val household = account.bootstrap.households.first(); api.createProfile(endpoint.baseUrl, account.session.token, household.id, name, kids, color, cleanUrl, active?.id.takeIf { copyAddons }) } else api.updateProfile(endpoint.baseUrl, account.session.token, profile.id, name, kids, color, cleanUrl) }.onSuccess { onSaved(it.id); onBack() }.onFailure { error = it.message ?: "Unable to save profile" }; saving = false } }, enabled = !saving, modifier = Modifier.padding(horizontal = 10.dp).fillMaxWidth().height(54.dp)) { if (saving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (profile == null) "Create profile" else "Save changes") } }
    }
}

private data class SettingEntry(val title: String, val description: String, val icon: ImageVector)
