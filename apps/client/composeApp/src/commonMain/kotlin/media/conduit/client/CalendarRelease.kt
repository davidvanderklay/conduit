package media.conduit.client

import media.conduit.client.account.CatalogItem
import media.conduit.client.account.LibraryItemSummary
import media.conduit.client.account.MetaItem

internal data class CalendarMonth(val year: Int, val month: Int)

internal data class CalendarDate(val year: Int, val month: Int, val day: Int) {
    val calendarMonth: CalendarMonth get() = CalendarMonth(year, month)
    val key: String get() = calendarDateKey(calendarMonth, day)
}

internal data class MobileCalendarRelease(
    val key: String,
    val date: String,
    val item: CatalogItem,
    val videoId: String? = null,
    val image: String? = null,
    val title: String,
    val subtitle: String,
)

internal fun buildMobileCalendarReleases(
    items: List<Pair<LibraryItemSummary, MetaItem>>,
): List<MobileCalendarRelease> = items.flatMap { (saved, meta) ->
    val item = meta.asCatalogItem()
    if (saved.type == "movie") {
        releaseDateKey(meta.released)?.let { date ->
            listOf(
                MobileCalendarRelease(
                    key = "movie:${saved.id}:$date",
                    date = date,
                    item = item,
                    image = meta.poster ?: meta.background,
                    title = meta.name,
                    subtitle = "Movie release",
                ),
            )
        }.orEmpty()
    } else {
        meta.videos.mapNotNull { video ->
            val date = releaseDateKey(video.released) ?: return@mapNotNull null
            MobileCalendarRelease(
                key = "series:${saved.id}:${video.id}:$date",
                date = date,
                item = item,
                videoId = video.id,
                image = video.thumbnail ?: meta.background ?: meta.poster,
                title = meta.name,
                subtitle = buildString {
                    val season = video.season
                    val episode = video.episode
                    if (season != null) append("S$season")
                    if (episode != null) append("E$episode")
                    val videoTitle = video.title ?: video.name
                    if (!videoTitle.isNullOrBlank()) {
                        if (isNotEmpty()) append(" · ")
                        append(videoTitle)
                    }
                }.ifBlank { "Episode release" },
            )
        }
    }
}.sortedWith(
    compareBy<MobileCalendarRelease>(MobileCalendarRelease::date)
        .thenBy { it.title.lowercase() }
        .thenBy(MobileCalendarRelease::key),
)

internal fun parseCalendarDate(value: String): CalendarDate? {
    val key = releaseDateKey(value) ?: return null
    val parts = key.split('-')
    return CalendarDate(parts[0].toInt(), parts[1].toInt(), parts[2].toInt())
}

internal fun releaseDateKey(value: String?): String? {
    if (value == null) return null
    val match = Regex("^(\\d{4})-(\\d{2})-(\\d{2})(?:T|$)").find(value) ?: return null
    val year = match.groupValues[1].toInt()
    val month = match.groupValues[2].toInt()
    val day = match.groupValues[3].toInt()
    if (year < 1 || month !in 1..12 || day !in 1..daysInCalendarMonth(CalendarMonth(year, month))) return null
    return "${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
}

internal fun shiftCalendarMonth(value: CalendarMonth, amount: Int): CalendarMonth {
    val index = value.year * 12 + value.month - 1 + amount
    val year = if (index >= 0) index / 12 else (index - 11) / 12
    return CalendarMonth(year, index - year * 12 + 1)
}

internal fun daysInCalendarMonth(value: CalendarMonth): Int = when (value.month) {
    2 -> if (value.year % 400 == 0 || value.year % 4 == 0 && value.year % 100 != 0) 29 else 28
    4, 6, 9, 11 -> 30
    else -> 31
}

internal fun calendarMonthOffset(value: CalendarMonth): Int {
    val offsets = intArrayOf(0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4)
    val adjustedYear = value.year - if (value.month < 3) 1 else 0
    return (adjustedYear + adjustedYear / 4 - adjustedYear / 100 + adjustedYear / 400 + offsets[value.month - 1] + 1) % 7
}

internal fun calendarMonthKey(value: CalendarMonth): String =
    "${value.year.toString().padStart(4, '0')}-${value.month.toString().padStart(2, '0')}"

internal fun calendarDateKey(value: CalendarMonth, day: Int): String =
    "${calendarMonthKey(value)}-${day.toString().padStart(2, '0')}"
