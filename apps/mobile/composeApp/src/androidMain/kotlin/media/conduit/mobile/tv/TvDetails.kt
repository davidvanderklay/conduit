package media.conduit.mobile.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.BookmarkAdd
import androidx.compose.material.icons.rounded.BookmarkAdded
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlayCircleOutline
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import media.conduit.mobile.DiscoverSelection
import media.conduit.mobile.EpisodeWatchState
import media.conduit.mobile.MobileBrowseTarget
import media.conduit.mobile.PlayerOpeningOverlay
import media.conduit.mobile.TvDetailsModel
import media.conduit.mobile.TvStreamsModel
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.ProfileMutation
import media.conduit.mobile.account.ProfileSnapshot
import media.conduit.mobile.displayTitle
import media.conduit.mobile.account.StreamSource
import media.conduit.mobile.account.VideoItem
import media.conduit.mobile.effectiveStreamAddonId
import media.conduit.mobile.episodeProgressFraction
import media.conduit.mobile.episodeReleaseDateLabel
import media.conduit.mobile.episodeWatchState
import media.conduit.mobile.progressForVideo
import media.conduit.mobile.streamCardCopy

private const val PlayFocusKey = "play"

/**
 * Details for one title. The left column carries the title and its actions; the
 * right panel lists episodes and swaps to the stream list once one is chosen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TvDetails(model: TvDetailsModel) {
    val meta = model.meta
    val item = model.item
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val playerOpen = LocalTvPlayerOpen.current
    val memory = remember(item.id) { TvFocusMemory().apply { key = PlayFocusKey } }
    val playFocus = remember(item.id) { FocusRequester() }
    val streamsFocus = remember(item.id) { FocusRequester() }
    val streamsOpen = model.streams != null
    val opening = model.openingStatus != null

    // Whichever layer is on top takes focus; lower layers get their last tile back.
    LaunchedEffect(streamsOpen, opening, playerOpen) {
        when {
            opening || playerOpen -> Unit
            streamsOpen -> streamsFocus.requestFocusWhenReady()
            !memory.restore() -> playFocus.requestFocusWhenReady()
        }
    }

    if (opening) {
        PlayerOpeningOverlay(
            artwork = meta?.background ?: item.background ?: meta?.poster ?: item.poster,
            logo = meta?.logo,
            title = meta?.name ?: item.name,
            status = model.openingStatus,
            modifier = Modifier.fillMaxSize(),
        )
        return
    }

    val videos = meta?.videos.orEmpty()
    val showPanel = streamsOpen || videos.isNotEmpty()
    Box(Modifier.fillMaxSize()) {
        TvBackdrop(meta?.background ?: item.background ?: meta?.poster ?: item.poster)
        Row(
            Modifier.fillMaxSize().padding(horizontal = 44.dp, vertical = TvSpacing.Edge),
            horizontalArrangement = Arrangement.spacedBy(32.dp),
        ) {
            Column(
                Modifier.weight(1f).fillMaxHeight().tvFocusBlocked(streamsOpen),
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
            ) {
                val logo = meta?.logo?.takeIf(String::isNotBlank)
                if (logo != null) {
                    AsyncImage(
                        logo,
                        meta.name,
                        Modifier.heightIn(max = 84.dp).widthIn(max = 320.dp),
                        contentScale = ContentScale.Fit,
                        alignment = Alignment.CenterStart,
                    )
                } else {
                    Text(
                        meta?.name ?: item.name,
                        color = Color.White,
                        style = MaterialTheme.typography.displayMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                TvFacts(
                    listOfNotNull(meta?.releaseInfo ?: meta?.released?.take(4) ?: item.releaseInfo, meta?.runtime, meta?.contentRating),
                    imdbRating = meta?.imdbRating,
                )
                model.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                (meta?.description ?: item.description)?.trim()?.takeIf(String::isNotBlank)?.let {
                    Text(it, color = Color(0xFFD4D4D8), style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 500.dp))
                }
                FlowRow(
                    Modifier.padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TvButton(
                        model.playLabel,
                        onClick = model.onPlay,
                        icon = Icons.Rounded.PlayArrow,
                        primary = true,
                        modifier = Modifier.focusRequester(playFocus).tvRememberFocus(memory, PlayFocusKey),
                    )
                    TvButton(
                        if (model.saved) "In library" else "Add to library",
                        onClick = { scope.launch { model.onMutation(ProfileMutation.SetLibrary(item, !model.saved, meta?.runtime)) } },
                        icon = if (model.saved) Icons.Rounded.BookmarkAdded else Icons.Rounded.BookmarkAdd,
                        modifier = Modifier.tvRememberFocus(memory, "library"),
                    )
                    if (item.type == "movie") {
                        val progress = model.snapshot?.progress.orEmpty().firstOrNull { it.videoId == item.id }
                        val watched = progress?.watched == true
                        TvButton(
                            if (watched) "Unwatch" else "Watched",
                            onClick = { scope.launch { model.onMutation(ProfileMutation.SetWatched(item, progress, watched = !watched)) } },
                            icon = if (watched) Icons.Rounded.Replay else Icons.Rounded.Check,
                            modifier = Modifier.tvRememberFocus(memory, "watched"),
                        )
                    }
                    val trailerId = meta?.trailerStreams?.firstNotNullOfOrNull { it.youtubeId?.trim()?.takeIf(String::isNotBlank) }
                        ?: meta?.trailers?.firstNotNullOfOrNull { it.source?.trim()?.takeIf(String::isNotBlank) }
                    trailerId?.takeIf { id -> id.all { it.isLetterOrDigit() || it == '-' || it == '_' } }?.let { id ->
                        TvButton(
                            "Trailer",
                            onClick = { uriHandler.openUri("https://www.youtube.com/watch?v=$id") },
                            icon = Icons.Rounded.PlayCircleOutline,
                            modifier = Modifier.tvRememberFocus(memory, "trailer"),
                        )
                    }
                }
                val genres = meta?.genres.orEmpty().map(String::trim).filter(String::isNotBlank).distinct()
                if (genres.isNotEmpty()) {
                    TvSectionLabel("Genres", Modifier.padding(top = 8.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(genres) { genre ->
                            TvChip(
                                genre,
                                selected = false,
                                onClick = { model.onBrowse(MobileBrowseTarget.Discover(DiscoverSelection(type = meta?.type, genre = genre))) },
                                modifier = Modifier.tvRememberFocus(memory, "genre:$genre"),
                            )
                        }
                    }
                }
                val cast = meta?.cast.orEmpty().map(String::trim).filter(String::isNotBlank).distinct().take(6)
                if (cast.isNotEmpty()) {
                    TvSectionLabel("Cast", Modifier.padding(top = 4.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(cast) { name ->
                            TvChip(
                                name,
                                selected = false,
                                onClick = { model.onBrowse(MobileBrowseTarget.Search(name)) },
                                modifier = Modifier.tvRememberFocus(memory, "cast:$name"),
                            )
                        }
                    }
                }
            }
            if (showPanel) {
                Column(
                    Modifier
                        .width(370.dp)
                        .fillMaxHeight()
                        .background(TvColors.Panel, RoundedCornerShape(14.dp))
                        .border(1.dp, TvColors.Hairline, RoundedCornerShape(14.dp))
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val streams = model.streams
                    if (streams != null) {
                        TvStreamsPanel(streams, title = meta?.name ?: item.name, onBack = model.onBack, focus = streamsFocus)
                    } else {
                        TvSectionLabel("Episodes")
                        TvEpisodeList(
                            item = item,
                            videos = videos,
                            snapshot = model.snapshot,
                            seasons = model.seasons,
                            selectedSeason = model.selectedSeason,
                            onSelectSeason = model.onSelectSeason,
                            scrollToVideoId = model.playVideoId,
                            onSelect = model.onSelectEpisode,
                            memory = memory,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Season chips above an episode list. Shared by the details panel and the
 * in-player episode drawer.
 */
@Composable
internal fun TvEpisodeList(
    item: CatalogItem,
    videos: List<VideoItem>,
    snapshot: ProfileSnapshot?,
    seasons: List<Int>,
    selectedSeason: Int?,
    onSelectSeason: (Int) -> Unit,
    scrollToVideoId: String?,
    onSelect: (VideoItem) -> Unit,
    memory: TvFocusMemory? = null,
    /** Attached to the [scrollToVideoId] episode so a drawer can open with focus on it. */
    currentFocus: FocusRequester? = null,
) {
    if (seasons.size > 1) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(seasons) { season ->
                TvChip(
                    if (season == 0) "Specials" else "Season $season",
                    selected = season == selectedSeason,
                    onClick = { onSelectSeason(season) },
                    modifier = if (memory != null) Modifier.tvRememberFocus(memory, "season:$season") else Modifier,
                )
            }
        }
    }
    val episodes = remember(videos, selectedSeason) {
        videos.filter { it.season == selectedSeason }.sortedBy { it.episode ?: 0 }
    }
    val listState = rememberLazyListState()
    LaunchedEffect(episodes, scrollToVideoId) {
        val target = episodes.indexOfFirst { it.id == scrollToVideoId }
        if (target > 0) listState.scrollToItem(target)
    }
    LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(4.dp), contentPadding = PaddingValues(bottom = 8.dp)) {
        items(episodes, key = VideoItem::id) { video ->
            val progress = progressForVideo(snapshot?.progress.orEmpty(), item, video)
            val watched = episodeWatchState(progress) == EpisodeWatchState.Watched
            val fraction = episodeProgressFraction(progress)
            TvFocusable(
                onClick = { onSelect(video) },
                modifier = Modifier.fillMaxWidth()
                    .then(if (currentFocus != null && video.id == scrollToVideoId) Modifier.focusRequester(currentFocus) else Modifier)
                    .then(if (memory != null) Modifier.tvRememberFocus(memory, "episode:${video.id}") else Modifier),
                container = { focused ->
                    when {
                        focused -> TvColors.ControlFocused
                        video.id == scrollToVideoId -> Color.White.copy(alpha = .05f)
                        else -> Color.Transparent
                    }
                },
            ) {
                Row(Modifier.padding(7.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(96.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow)) {
                        AsyncImage(video.thumbnail, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        if (watched) {
                            Icon(Icons.Rounded.CheckCircle, "Watched", tint = TvColors.Amber, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(16.dp))
                        } else if (fraction > 0f) {
                            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = .22f)))
                            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth(fraction.coerceIn(0f, 1f)).height(3.dp).background(Color(0xFFFFBD00)))
                        }
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        val named = video.title?.takeIf(String::isNotBlank) ?: video.name?.takeIf(String::isNotBlank)
                        Text(
                            if (named != null && video.episode != null) "${video.episode}. $named" else video.displayTitle,
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        video.released?.let { released ->
                            Text(episodeReleaseDateLabel(released) ?: released, color = TvColors.Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                        }
                        (video.overview ?: video.description)?.takeIf(String::isNotBlank)?.let {
                            Text(it, color = TvColors.Dim, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

/** The stream list for one movie or episode, grouped by an add-on filter. */
@Composable
internal fun TvStreamsPanel(model: TvStreamsModel, title: String, onBack: () -> Unit, focus: FocusRequester) {
    val firstStream = remember { FocusRequester() }
    LaunchedEffect(model.loading, model.streams.isNotEmpty()) {
        if (!model.loading && model.streams.isNotEmpty()) firstStream.requestFocusWhenReady()
    }
    TvFocusable(onClick = onBack, modifier = Modifier.fillMaxWidth().focusRequester(focus)) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White, modifier = Modifier.size(18.dp))
            Column {
                TvSectionLabel(
                    model.episode?.let { episode ->
                        listOfNotNull(
                            if (episode.season != null && episode.episode != null) "S${episode.season} E${episode.episode}" else null,
                            episode.displayTitle,
                        ).joinToString(" · ")
                    } ?: title,
                )
                Text(
                    listOfNotNull("Streams", model.resumeFrom?.let { "resume from $it" }).joinToString(" · "),
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }
    }
    if (model.addonChoices.size > 1) {
        val selected = effectiveStreamAddonId(model.selectedAddonId, model.addonChoices)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { TvChip("All", selected = selected == null, onClick = { model.onSelectAddon(null) }) }
            items(model.addonChoices) { choice ->
                TvChip(choice.name, selected = selected == choice.id, onClick = { model.onSelectAddon(choice.id) })
            }
        }
    }
    when {
        model.loading -> Text("Finding streams…", color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(8.dp))
        model.error != null || model.streams.isEmpty() -> {
            Text(model.error ?: "No streams were returned.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(8.dp))
            TvButton("Try again", onClick = model.onRetry)
        }
    }
    if (!model.loading) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(bottom = 8.dp)) {
            items(model.streams.size) { index ->
                TvStreamCard(
                    model.streams[index],
                    onClick = { model.onSelect(model.streams[index]) },
                    modifier = if (index == 0) Modifier.focusRequester(firstStream) else Modifier,
                )
            }
        }
    }
}

@Composable
internal fun TvStreamCard(source: StreamSource, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val copy = remember(source) { source.stream.streamCardCopy() }
    val playable = media.conduit.mobile.account.isPlayableStream(source.stream)
    TvFocusable(
        onClick = onClick,
        enabled = playable,
        modifier = modifier.fillMaxWidth(),
        container = { focused -> if (focused) TvColors.ControlFocused else Color.White.copy(alpha = .035f) },
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                copy.headline,
                color = if (playable) Color.White else Color.White.copy(alpha = .4f),
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            copy.detailLines.take(3).forEach { line ->
                Text(line, color = TvColors.Muted, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(
                if (playable) source.addonName else "${source.addonName} · not playable on this device",
                color = TvColors.Dim,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
    }
}

@Composable
internal fun TvChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(50),
        container = { focused ->
            when {
                focused -> TvColors.ControlFocused
                selected -> Color(0xFF27272A)
                else -> TvColors.Control
            }
        },
    ) {
        Text(
            label,
            color = if (selected) TvColors.AmberSoft else Color.White,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.labelLarge,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
}
