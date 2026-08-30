package media.conduit.mobile

import kotlin.math.ceil
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem
import media.conduit.mobile.account.progressByRecency

internal enum class ContinueWatchingKind { InProgress, NewEpisode, NextUp, Scheduled, CaughtUp }

internal data class ContinueWatchingPresentation(
    val kind: ContinueWatchingKind,
    val video: VideoItem? = null,
    val label: String? = null,
)

internal fun groupContinueWatching(items: List<ProgressSummary>): List<ProgressSummary> {
    return coreValue(buildJsonObject {
        put("type", "groupContinueWatching")
        put("progress", ProtocolJson.encodeToJsonElement(items))
    }).jsonArray.mapNotNull { index -> items.getOrNull(index.jsonPrimitive.content.toInt()) }
}

internal fun progressTitleUiKey(progress: ProgressSummary): String =
    progress.canonicalTitleId ?: "${progress.mediaType}\u001f${progress.mediaId}"

internal fun progressEpisodeUiKey(progress: ProgressSummary): String {
    val episode = progress.canonicalEpisodeKey
        ?: if (progress.season != null || progress.episode != null) {
            "s${progress.season ?: 0}:e${progress.episode ?: 0}"
        } else {
            progress.videoId
        }
    return "${progressTitleUiKey(progress)}\u001f$episode"
}

internal fun progressHistoryForDisplay(items: List<ProgressSummary>): List<ProgressSummary> =
    progressByRecency(items).distinctBy(::progressEpisodeUiKey)

internal fun continueWatchingPresentation(
    progress: ProgressSummary,
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
    now: Instant = Clock.System.now(),
    watchedVideoIds: Set<String> = emptySet(),
): ContinueWatchingPresentation {
    val result = coreValue(buildJsonObject {
        put("type", "continueWatching")
        put("progress", ProtocolJson.encodeToJsonElement(progress))
        put("videos", ProtocolJson.encodeToJsonElement(videos))
        put("today", today)
        put("nowMs", now.toEpochMilliseconds())
        put("watchedVideoIds", ProtocolJson.encodeToJsonElement(watchedVideoIds))
    }).jsonObject
    val video = result["videoIndex"]?.jsonPrimitive?.content?.toIntOrNull()?.let(videos::getOrNull)
    return when (result.getValue("kind").jsonPrimitive.content) {
        "in-progress" -> ContinueWatchingPresentation(ContinueWatchingKind.InProgress, video)
        "new-episode" -> ContinueWatchingPresentation(ContinueWatchingKind.NewEpisode, video)
        "next-up" -> ContinueWatchingPresentation(ContinueWatchingKind.NextUp, video)
        "scheduled" -> ContinueWatchingPresentation(
            ContinueWatchingKind.Scheduled,
            video,
            video?.released?.let { releaseDateLabel(it, today) },
        )
        else -> ContinueWatchingPresentation(ContinueWatchingKind.CaughtUp, video)
    }
}

internal fun continueWatchingBadgeLabel(
    progress: ProgressSummary,
    presentation: ContinueWatchingPresentation,
    metadataReady: Boolean,
): String {
    if (!metadataReady && progress.mediaType == "series" && progress.watched) return "Next Up"

    return when (presentation.kind) {
        ContinueWatchingKind.InProgress -> remainingTimeLabel(progress)
            ?: progressPercentLabel(progress)
            ?: if (progress.mediaType == "series") "Next Up" else if (progress.watched) "Watched" else "Resume"
        ContinueWatchingKind.NewEpisode -> "New Episode"
        ContinueWatchingKind.NextUp -> "Next Up"
        ContinueWatchingKind.Scheduled -> presentation.label ?: "Upcoming"
        ContinueWatchingKind.CaughtUp -> "Caught up"
    }
}

internal fun remainingTimeLabel(progress: ProgressSummary): String? {
    if (progress.watched || progress.durationMs <= 0 || progress.durationMs <= progress.positionMs) return null
    val minutes = ceil((progress.durationMs - progress.positionMs) / 60_000.0).toInt().coerceAtLeast(1)
    if (minutes < 60) return "$minutes min left"
    val hours = minutes / 60
    val remainder = minutes % 60
    return if (remainder == 0) "${hours}h left" else "${hours}h ${remainder}m left"
}

private fun progressPercentLabel(progress: ProgressSummary): String? {
    if (progress.watched || progress.positionMs <= 0L || progress.durationMs <= 0L) return null
    val percent = ((progress.positionMs.toDouble() / progress.durationMs) * 100).toInt().coerceIn(1, 99)
    return "$percent% watched"
}

internal fun releaseDateLabel(released: String, today: String): String {
    val day = releaseDay(released) ?: return released
    if (day == today) return "Today"
    if (day == nextIsoDay(today)) return "Tomorrow"
    val month = day.substring(5, 7).toIntOrNull()?.let { monthNames.getOrNull(it - 1) }
    val date = day.substring(8, 10).toIntOrNull()
    return if (month != null && date != null) "$month $date" else released
}

internal fun episodeReleaseDateLabel(released: String?): String? {
    val day = releaseDay(released) ?: return released?.takeIf(String::isNotBlank)
    val year = day.substring(0, 4)
    val month = day.substring(5, 7).toIntOrNull()?.let { monthNames.getOrNull(it - 1) }
    val date = day.substring(8, 10).toIntOrNull()
    return if (month != null && date != null) "$month $date, $year" else released
}

private fun compareEpisodes(a: VideoItem, b: VideoItem): Int =
    compareValues(a.season, b.season).takeIf { it != 0 }
        ?: compareValues(a.episode, b.episode).takeIf { it != 0 }
        ?: a.id.compareTo(b.id)

internal fun compareEpisodeCoordinates(a: VideoItem, b: VideoItem): Int =
    compareValues(a.season, b.season).takeIf { it != 0 }
        ?: compareValues(a.episode, b.episode)

private fun releaseDay(value: String?): String? =
    value?.take(10)?.takeIf { isoDayPattern.matches(it) }

private fun VideoItem.hasAired(today: String, now: Instant): Boolean {
    if (available == false) return false
    releaseInstant()?.let { return it <= now }
    if (available == true) return true
    val day = releaseDay(released) ?: return available != false
    return day <= today
}

private fun VideoItem.isUpcomingRelease(today: String, now: Instant): Boolean {
    if (!released.orEmpty().contains("T")) {
        return releaseDay(released)?.let {
            it > today || (available == false && it == today)
        } == true
    }
    return releaseInstant()?.let { it > now } == true
}

private fun VideoItem.isReleaseAlert(progress: ProgressSummary, now: Instant): Boolean {
    val releaseTimestamp = releaseInstant() ?: return false
    val watchedTimestamp = parseInstant(progress.updatedAt) ?: return false
    return releaseTimestamp > watchedTimestamp && now - releaseTimestamp < 60.days
}

private fun VideoItem.releaseInstant(): Instant? = released?.let(::parseInstant)

private fun parseInstant(value: String): Instant? {
    val trimmed = value.trim()
    return runCatching { Instant.parse(trimmed) }.getOrNull()
        ?: releaseDay(trimmed)?.let { day ->
            runCatching { Instant.parse("${day}T00:00:00Z") }.getOrNull()
        }
}

internal fun nextEpisodeAfter(
    progress: ProgressSummary?,
    videos: List<VideoItem>,
    watchedVideoIds: Set<String> = emptySet(),
    today: String = Clock.System.now().toString().take(10),
    now: Instant = Clock.System.now(),
    watchedProgress: List<ProgressSummary> = emptyList(),
): VideoItem? {
    if (progress == null) return null
    val regular = orderedPlayableEpisodes(videos, today, now)
    val anchor = videos.firstOrNull { progressMatchesVideo(progress, it) }
    val anchorSeason = anchor?.season ?: progress.season
    val anchorEpisode = anchor?.episode ?: progress.episode
    if (anchorSeason == null || anchorEpisode == null) return null
    return regular.firstOrNull {
        (
            it.season!! > anchorSeason ||
                (it.season == anchorSeason && it.episode!! > anchorEpisode)
            ) &&
            it.id !in watchedVideoIds &&
            watchedProgress.none { watched ->
                watched.watched && progressMatchesVideo(watched, it)
            }
    }
}

internal fun orderedContinueWatchingEpisodes(
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
    now: Instant = Clock.System.now(),
): List<VideoItem> = videos
    .filter {
        (it.season ?: 0) > 0 &&
            it.episode != null &&
            (it.available != false || it.isUpcomingRelease(today, now))
    }
    .sortedWith(compareBy<VideoItem>({ it.season }, { it.episode }, { it.id }))

internal fun orderedPlayableEpisodes(
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
    now: Instant = Clock.System.now(),
): List<VideoItem> = orderedContinueWatchingEpisodes(videos, today, now)
    .filter { it.hasAired(today, now) }

internal fun orderedEpisodePickerVideos(
    videos: List<VideoItem>,
): List<VideoItem> = orderedContinueWatchingEpisodes(videos)

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
