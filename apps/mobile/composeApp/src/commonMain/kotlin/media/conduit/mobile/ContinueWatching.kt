package media.conduit.mobile

import kotlin.math.ceil
import kotlin.time.Clock
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

internal enum class ContinueWatchingKind { InProgress, NewEpisode, Scheduled, CaughtUp }

internal data class ContinueWatchingPresentation(
    val kind: ContinueWatchingKind,
    val video: VideoItem? = null,
    val label: String? = null,
)

internal fun groupContinueWatching(items: List<ProgressSummary>): List<ProgressSummary> {
    val grouped = linkedMapOf<String, ProgressSummary>()
    items.forEach { item ->
        val key = if (item.mediaType == "series") {
            "${item.mediaType}:${item.mediaId}"
        } else {
            "${item.mediaType}:${item.mediaId}:${item.videoId}"
        }
        val current = grouped[key]
        if (current == null || item.updatedAt > current.updatedAt) grouped[key] = item
    }
    return grouped.values.toList()
}

internal fun continueWatchingPresentation(
    progress: ProgressSummary,
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
): ContinueWatchingPresentation {
    val regular = videos
        .filter { (it.season ?: 0) > 0 && it.episode != null }
        .sortedWith(compareBy<VideoItem>({ it.season }, { it.episode }, { it.id }))
    val anchor = regular.firstOrNull { it.id == progress.videoId }
        ?: regular.firstOrNull { it.season == progress.season && it.episode == progress.episode }

    if (progress.mediaType != "series" || !progress.watched) {
        return ContinueWatchingPresentation(ContinueWatchingKind.InProgress, anchor)
    }
    if (anchor == null) return ContinueWatchingPresentation(ContinueWatchingKind.CaughtUp)

    val later = regular.filter { compareEpisodes(it, anchor) > 0 }
    later.firstOrNull { it.hasReleased(today) }
        ?.let { return ContinueWatchingPresentation(ContinueWatchingKind.NewEpisode, it) }
    later.firstOrNull { releaseDay(it.released) != null }
        ?.let { return ContinueWatchingPresentation(ContinueWatchingKind.Scheduled, it, releaseDateLabel(it.released!!, today)) }
    return ContinueWatchingPresentation(ContinueWatchingKind.CaughtUp, anchor)
}

internal fun remainingTimeLabel(progress: ProgressSummary): String? {
    if (progress.watched || progress.durationMs <= 0 || progress.durationMs <= progress.positionMs) return null
    val minutes = ceil((progress.durationMs - progress.positionMs) / 60_000.0).toInt().coerceAtLeast(1)
    if (minutes < 60) return "$minutes min left"
    val hours = minutes / 60
    val remainder = minutes % 60
    return if (remainder == 0) "${hours}h left" else "${hours}h ${remainder}m left"
}

internal fun releaseDateLabel(released: String, today: String): String {
    val day = releaseDay(released) ?: return released
    if (day == today) return "Today"
    if (day == nextIsoDay(today)) return "Tomorrow"
    val month = day.substring(5, 7).toIntOrNull()?.let { monthNames.getOrNull(it - 1) }
    val date = day.substring(8, 10).toIntOrNull()
    return if (month != null && date != null) "$month $date" else released
}

private fun compareEpisodes(a: VideoItem, b: VideoItem): Int =
    compareValues(a.season, b.season).takeIf { it != 0 }
        ?: compareValues(a.episode, b.episode).takeIf { it != 0 }
        ?: a.id.compareTo(b.id)

private fun releaseDay(value: String?): String? =
    value?.take(10)?.takeIf { isoDayPattern.matches(it) }

private fun VideoItem.hasReleased(today: String): Boolean {
    if (available == true) return true
    val day = releaseDay(released) ?: return available != false
    return day < today
}

private fun nextIsoDay(day: String): String {
    val year = day.substring(0, 4).toInt()
    val month = day.substring(5, 7).toInt()
    val date = day.substring(8, 10).toInt()
    val daysInMonth = when (month) {
        2 -> if (year % 400 == 0 || (year % 4 == 0 && year % 100 != 0)) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }
    if (date < daysInMonth) return isoDay(year, month, date + 1)
    if (month < 12) return isoDay(year, month + 1, 1)
    return isoDay(year + 1, 1, 1)
}

private fun isoDay(year: Int, month: Int, day: Int): String =
    "${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"

private val isoDayPattern = Regex("\\d{4}-\\d{2}-\\d{2}")
private val monthNames = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
