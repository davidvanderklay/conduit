package media.conduit.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import media.conduit.mobile.account.*

internal class HomeScreenCache {
    val result = mutableStateOf<HomeCatalogResult?>(null)
    val loading = mutableStateOf(false)
    val catalogError = mutableStateOf<String?>(null)
}

@Composable
internal fun HomeScreen(
    profile: ProfileSummary?,
    sync: ProfileSyncState,
    api: ConduitApi,
    onSelect: (CatalogItem, String?) -> Unit,
    listState: LazyListState = rememberLazyListState(),
    cache: HomeScreenCache = remember { HomeScreenCache() },
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var result by cache.result
    var loading by cache.loading
    var catalogError by cache.catalogError

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

    val continueWatching = sync.snapshot?.continueWatching.orEmpty()
    val library = sync.snapshot?.library.orEmpty().sortedByDescending { it.updatedAt }.take(14)

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize().statusBarsPadding(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 14.dp, bottom = 112.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "${profile?.name ?: "Your"} space",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    "What are we watching?",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "Movies, series, and your synced watchlist in one place.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (sync.offline) {
            item { StatusPill("Offline · showing saved activity", MaterialTheme.colorScheme.tertiary) }
        }
        if (continueWatching.isNotEmpty()) {
            item { ShelfTitle("Continue Watching") }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(continueWatching, key = { it.videoId }) { item ->
                        ContinueCard(item) {
                            onSelect(
                                CatalogItem(item.mediaId, item.mediaType, item.name, poster = item.poster),
                                if (item.mediaType == "series") item.mediaId else item.videoId,
                            )
                        }
                    }
                }
            }
        }
        if (library.isNotEmpty()) {
            item { ShelfTitle("From Your Library") }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(library, key = { it.id }) { item ->
                        PosterCard(item.name, item.poster, item.type) {
                            onSelect(CatalogItem(item.id, item.type, item.name, poster = item.poster), null)
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
            item(key = "${catalog.key}:title") { ShelfTitle(catalog.title) }
            item(key = catalog.key) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(catalog.items, key = { "${catalog.key}:${it.type}:${it.id}" }) { item ->
                        PosterCard(item.name, item.poster, item.releaseInfo ?: item.type) { onSelect(item, null) }
                    }
                }
            }
        }
        if (!loading && sync.snapshot != null && continueWatching.isEmpty() && library.isEmpty() &&
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
}

@Composable
private fun ShelfTitle(title: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text("See all", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun PosterCard(name: String, poster: String?, caption: String?, onClick: () -> Unit) {
    Column(Modifier.width(112.dp).clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            AsyncImage(
                model = poster,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier.fillMaxWidth().height(48.dp).align(Alignment.BottomCenter)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .72f)))),
            )
        }
        Text(name, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        caption?.let {
            Text(it.replaceFirstChar(Char::uppercase), maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun ContinueCard(item: ProgressSummary, onClick: () -> Unit) {
    val progress = (item.positionMs.toFloat() / item.durationMs.toFloat()).coerceIn(0f, 1f)
    Column(Modifier.width(210.dp).clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF342B55), Color(0xFF17151E)))))
            AsyncImage(
                model = item.poster,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (item.poster == null) {
                Text(item.name.take(1), modifier = Modifier.align(Alignment.Center), style = MaterialTheme.typography.displayMedium, color = Color.White.copy(alpha = .24f))
            }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .45f)))))
            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(4.dp).align(Alignment.BottomCenter))
        }
        Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
        Text(
            item.videoTitle ?: listOfNotNull(item.season?.let { "S$it" }, item.episode?.let { "E$it" })
                .joinToString(" · ").ifBlank { "${item.positionMs / 60_000} min watched" },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall,
        )
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
