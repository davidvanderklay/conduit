package media.conduit.client

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlin.math.min
import kotlin.time.Clock
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import media.conduit.client.account.CatalogItem
import media.conduit.client.account.ConduitApi
import media.conduit.client.account.ProfileSnapshot

private val CalendarMonthNames = listOf(
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
private val CalendarWeekdays = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

@Composable
internal fun MobileCalendarScreen(
    snapshot: ProfileSnapshot?,
    api: ConduitApi,
    active: Boolean,
    onBack: () -> Unit,
    onBackCancelled: (() -> Unit)? = null,
    onSelect: (CatalogItem, String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    PlatformBackHandler(
        enabled = active,
        onBack = onBack,
        onBackCancelled = onBackCancelled,
        interactiveBack = onBackCancelled != null,
    )
    val today = remember {
        parseCalendarDate(Clock.System.now().toString().take(10)) ?: CalendarDate(2026, 1, 1)
    }
    var month by remember(snapshot?.profileId) { mutableStateOf(today.calendarMonth) }
    var selectedDay by remember(snapshot?.profileId) { mutableStateOf(today.day) }
    val metadataCache = rememberWatchMetadataCache(api, snapshot?.addons.orEmpty())
    val metadataKey = buildString {
        snapshot?.library.orEmpty().forEach { append("${it.type}:${it.id}:${it.updatedAt}|") }
        snapshot?.addons.orEmpty().forEach { append("${it.id}:${it.enabled}|") }
    }
    var preparedMetadataKey by remember(snapshot?.profileId) { mutableStateOf<String?>(null) }

    LaunchedEffect(active, metadataKey, metadataCache, snapshot?.profileId) {
        if (!active) return@LaunchedEffect
        val current = snapshot ?: return@LaunchedEffect
        coroutineScope {
            current.library.forEach { saved ->
                launch { metadataCache.load(saved.asCatalogItem(), includeMovies = true) }
            }
        }
        preparedMetadataKey = metadataKey
    }

    val loading = snapshot == null || preparedMetadataKey != metadataKey
    val releases = if (loading) {
        emptyList()
    } else {
        buildMobileCalendarReleases(
            snapshot.library.mapNotNull { saved ->
                metadataCache.metadataFor(saved.asCatalogItem())?.let { saved to it }
            },
        )
    }
    val monthKey = calendarMonthKey(month)
    val monthReleases = releases.filter { it.date.startsWith(monthKey) }
    val selectedDate = calendarDateKey(month, selectedDay)
    val selectedReleases = monthReleases.filter { it.date == selectedDate }
    val releaseDays = monthReleases.mapNotNull { it.date.takeLast(2).toIntOrNull() }.toSet()

    val nextMonth = {
        month = shiftCalendarMonth(month, 1)
        selectedDay = min(selectedDay, daysInCalendarMonth(month))
    }
    BoxWithConstraints(modifier.fillMaxSize().statusBarsPadding()) {
        val horizontalLayout = maxWidth >= 700.dp && maxHeight >= 500.dp && maxWidth > maxHeight
        if (horizontalLayout) {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                CalendarHeader(onBack = onBack)
                Row(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    CalendarMonthCard(
                        modifier = Modifier.widthIn(min = 360.dp, max = 500.dp),
                        month = month,
                        today = today,
                        selectedDay = selectedDay,
                        releaseDays = releaseDays,
                        releaseCount = monthReleases.size,
                        onPrevious = {
                            month = shiftCalendarMonth(month, -1)
                            selectedDay = min(selectedDay, daysInCalendarMonth(month))
                        },
                        onNext = nextMonth,
                        onToday = {
                            month = today.calendarMonth
                            selectedDay = today.day
                        },
                        onSelectDay = { selectedDay = it },
                    )
                    CalendarAgenda(
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                        month = month,
                        selectedDay = selectedDay,
                        selectedReleases = selectedReleases,
                        loading = loading,
                        today = today,
                        onSelect = onSelect,
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 44.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                item { CalendarHeader(onBack = onBack) }
                item {
                    CalendarMonthCard(
                        month = month,
                        today = today,
                        selectedDay = selectedDay,
                        releaseDays = releaseDays,
                        releaseCount = monthReleases.size,
                        onPrevious = {
                            month = shiftCalendarMonth(month, -1)
                            selectedDay = min(selectedDay, daysInCalendarMonth(month))
                        },
                        onNext = nextMonth,
                        onToday = {
                            month = today.calendarMonth
                            selectedDay = today.day
                        },
                        onSelectDay = { selectedDay = it },
                    )
                }
                item {
                    CalendarAgendaHeader(
                        month = month,
                        selectedDay = selectedDay,
                        releaseCount = selectedReleases.size,
                    )
                }
                if (loading) {
                    item {
                        Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                } else if (selectedReleases.isEmpty()) {
                    item {
                        Box(Modifier.fillMaxWidth().height(96.dp), contentAlignment = Alignment.Center) {
                            Text("No releases scheduled for this day.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                } else {
                    items(selectedReleases, key = MobileCalendarRelease::key) { release ->
                        CalendarReleaseRow(
                            release = release,
                            available = release.date <= today.key,
                            onClick = { onSelect(release.item, release.videoId) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarHeader(onBack: () -> Unit) {
    Row(verticalAlignment = Alignment.Top) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to library")
        }
        Column(Modifier.weight(1f).padding(top = 5.dp)) {
            Text("Calendar", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
            Text(
                "Episode releases from titles saved to your library.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun CalendarAgenda(
    modifier: Modifier,
    month: CalendarMonth,
    selectedDay: Int,
    selectedReleases: List<MobileCalendarRelease>,
    loading: Boolean,
    today: CalendarDate,
    onSelect: (CatalogItem, String?) -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CalendarAgendaHeader(month = month, selectedDay = selectedDay, releaseCount = selectedReleases.size)
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            selectedReleases.isEmpty() -> Box(
                Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text("No releases scheduled for this day.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(bottom = 8.dp),
            ) {
                items(selectedReleases, key = MobileCalendarRelease::key) { release ->
                    CalendarReleaseRow(
                        release = release,
                        available = release.date <= today.key,
                        onClick = { onSelect(release.item, release.videoId) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CalendarAgendaHeader(
    month: CalendarMonth,
    selectedDay: Int,
    releaseCount: Int,
) {
    Row(verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f)) {
            Text("Release agenda", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "${CalendarMonthNames[month.month - 1]} $selectedDay, ${month.year}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(50)) {
            Text(
                "${releaseCount} ${if (releaseCount == 1) "release" else "releases"}",
                modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Composable
private fun CalendarMonthCard(
    modifier: Modifier = Modifier,
    month: CalendarMonth,
    today: CalendarDate,
    selectedDay: Int,
    releaseDays: Set<Int>,
    releaseCount: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
    onSelectDay: (Int) -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(28.dp),
        color = Color(0xFF1C1C20),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .12f)),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onPrevious) { Icon(Icons.Rounded.ChevronLeft, "Previous month") }
                Column(Modifier.weight(1f)) {
                    Text(
                        "${CalendarMonthNames[month.month - 1]} ${month.year}",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "$releaseCount ${if (releaseCount == 1) "release" else "releases"}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                FilledTonalButton(onClick = onToday, shape = RoundedCornerShape(50)) {
                    Text("Today", fontWeight = FontWeight.Bold)
                }
                IconButton(onClick = onNext) { Icon(Icons.Rounded.ChevronRight, "Next month") }
            }

            Spacer(Modifier.height(18.dp))
            Row(Modifier.fillMaxWidth()) {
                CalendarWeekdays.forEach { weekday ->
                    Text(
                        weekday,
                        modifier = Modifier.weight(1f),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Spacer(Modifier.height(7.dp))

            val cells = buildList<Int?> {
                repeat(calendarMonthOffset(month)) { add(null) }
                (1..daysInCalendarMonth(month)).forEach(::add)
                while (size % 7 != 0) add(null)
            }
            cells.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    week.forEach { day ->
                        if (day == null) {
                            Spacer(Modifier.weight(1f).aspectRatio(1f))
                        } else {
                            CalendarDay(
                                day = day,
                                selected = day == selectedDay,
                                today = month == today.calendarMonth && day == today.day,
                                hasRelease = day in releaseDays,
                                onClick = { onSelectDay(day) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarDay(
    day: Int,
    selected: Boolean,
    today: Boolean,
    hasRelease: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.aspectRatio(1f).padding(2.dp),
        shape = RoundedCornerShape(14.dp),
        color = if (selected) Color.White else Color.Transparent,
        contentColor = if (selected) Color(0xFF111113) else if (hasRelease) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
        border = if (today && !selected) BorderStroke(2.dp, Color.White) else null,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text("$day", fontWeight = if (selected || hasRelease) FontWeight.Bold else FontWeight.Normal)
            if (hasRelease) {
                Box(
                    Modifier.align(Alignment.BottomCenter).padding(bottom = 5.dp).size(5.dp)
                        .background(if (selected) Color(0xFF111113) else Color.White, RoundedCornerShape(50)),
                )
            }
        }
    }
}

@Composable
private fun CalendarReleaseRow(
    release: MobileCalendarRelease,
    available: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        color = Color(0xFF202023),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .12f)),
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(width = 104.dp, height = 66.dp).clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            ) {
                AsyncImage(
                    model = release.image,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(release.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                Text(
                    release.subtitle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    if (available) "Available now" else "Coming soon",
                    color = if (available) Color(0xFF39D98A) else Color(0xFFFFBD00),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
            Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
