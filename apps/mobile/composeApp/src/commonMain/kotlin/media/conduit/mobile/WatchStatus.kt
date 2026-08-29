package media.conduit.mobile

import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.PlaybackSource
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

internal enum class PosterWatchState { Unwatched, Partial, Complete }
internal enum class EpisodeWatchState { NotStarted, InProgress, Watched }

private const val LegacyCompletionMarkerPrefix = "conduit:completion:"

internal fun episodeWatchState(progress: ProgressSummary?): EpisodeWatchState = when (
    coreValue(buildJsonObject {
        put("type", "episodeWatchState")
        put("progress", ProtocolJson.encodeToJsonElement(progress))
    }).jsonPrimitive.content
) {
    "watched" -> EpisodeWatchState.Watched
    "in-progress" -> EpisodeWatchState.InProgress
    else -> EpisodeWatchState.NotStarted
}

internal fun episodeProgressFraction(progress: ProgressSummary?): Float =
    coreValue(buildJsonObject {
        put("type", "episodeProgress")
        put("progress", ProtocolJson.encodeToJsonElement(progress))
    }).jsonPrimitive.content.toFloat()

internal fun resumePositionLabel(positionMs: Long): String? {
    if (positionMs <= 0L) return null
    val totalSeconds = positionMs / 1_000L
    val hours = totalSeconds / 3_600L
    val minutes = (totalSeconds / 60L) % 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) {
        "$hours:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    } else {
        "${totalSeconds / 60L}:${seconds.toString().padStart(2, '0')}"
    }
}

internal fun posterWatchState(
    progress: List<ProgressSummary>,
    item: CatalogItem,
    episodeIds: List<String> = emptyList(),
): PosterWatchState {
    return when (coreValue(buildJsonObject {
        put("type", "posterWatchState")
        put("progress", ProtocolJson.encodeToJsonElement(progress))
        put("mediaType", item.type)
        put("mediaId", item.id)
        put("episodeIds", ProtocolJson.encodeToJsonElement(episodeIds))
    }).jsonPrimitive.content) {
        "complete" -> PosterWatchState.Complete
        "partial" -> PosterWatchState.Partial
        else -> PosterWatchState.Unwatched
    }
}

internal fun completionEpisodeIds(
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
): List<String> = seriesWatchVideos(videos, today).map(VideoItem::id)

internal fun seasonWatchVideos(
    videos: List<VideoItem>,
    season: Int,
    today: String = Clock.System.now().toString().take(10),
): List<VideoItem> = eligibleVideoIndices(videos, season, today).map(videos::get)

internal fun progressForVideo(
    progress: List<ProgressSummary>,
    item: CatalogItem,
    video: VideoItem,
): ProgressSummary? = progress
    .filter {
        it.mediaType == item.type &&
            it.mediaId == item.id &&
            progressMatchesVideo(it, video)
    }
    .maxByOrNull(ProgressSummary::updatedAt)

internal fun progressMatchesVideo(progress: ProgressSummary, video: VideoItem): Boolean =
    if (
        progress.season != null &&
        progress.episode != null &&
        video.season != null &&
        video.episode != null
    ) {
        progress.season == video.season && progress.episode == video.episode
    } else {
        progress.videoId == video.id
    }

private fun progressVideo(
    videos: List<VideoItem>,
    progress: ProgressSummary,
): VideoItem? = videos.firstOrNull { progressMatchesVideo(progress, it) }

private fun canonicalProgressVideo(
    videos: List<VideoItem>,
    progress: ProgressSummary,
): VideoItem? = if (progress.season != null && progress.episode != null) {
    videos.firstOrNull {
        it.season == progress.season && it.episode == progress.episode
    }
} else {
    null
}

internal fun seriesWatchVideos(
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
): List<VideoItem> {
    val eligible = eligibleVideoIndices(videos, null, today).map(videos::get)
    val regular = eligible.filter { it.season != 0 }
    return regular.ifEmpty { eligible }
}

internal fun VideoItem.isReleasedOrAvailable(today: String): Boolean {
    return eligibleVideoIndices(listOf(this), null, today).isNotEmpty()
}

private fun eligibleVideoIndices(videos: List<VideoItem>, season: Int?, today: String): List<Int> {
    val endOfDay = runCatching { Instant.parse("${today}T23:59:59.999Z").toEpochMilliseconds() }
        .getOrElse { Clock.System.now().toEpochMilliseconds() }
    return coreValue(buildJsonObject {
        put("type", "eligibleWatchVideos")
        put("videos", ProtocolJson.encodeToJsonElement(videos))
        put("season", ProtocolJson.encodeToJsonElement(season))
        put("nowMs", endOfDay)
    }).jsonArray.map { it.jsonPrimitive.content.toInt() }
}

internal fun latestProgress(snapshot: media.conduit.mobile.account.ProfileSnapshot?, item: CatalogItem): ProgressSummary? =
    snapshot?.progress.orEmpty()
        .filter { it.mediaType == item.type && it.mediaId == item.id && !it.videoId.startsWith(LegacyCompletionMarkerPrefix) }
        .maxByOrNull(ProgressSummary::updatedAt)

internal fun latestUnfinishedProgress(
    progress: List<ProgressSummary>,
    item: CatalogItem,
): ProgressSummary? = progress
    .filter {
            it.mediaType == item.type && it.mediaId == item.id &&
            !it.videoId.startsWith(LegacyCompletionMarkerPrefix) &&
            !it.watched && it.positionMs >= 1_000
    }
    .maxByOrNull(ProgressSummary::updatedAt)

internal fun savedAutoResumeSource(
    progress: List<ProgressSummary>,
    item: CatalogItem,
    videoId: String?,
    video: VideoItem? = null,
): PlaybackSource? = progress
    .filter {
        it.mediaType == item.type &&
        it.mediaId == item.id &&
        !it.watched &&
        it.positionMs >= 1_000L &&
        if (video != null) progressMatchesVideo(it, video) else it.videoId == videoId
    }
    .maxByOrNull(ProgressSummary::updatedAt)
    ?.playbackSource

internal fun savedPlaybackSourceForVideo(
    progress: List<ProgressSummary>,
    item: CatalogItem,
    videos: List<VideoItem>,
    videoId: String,
): PlaybackSource? {
    val target = videos.firstOrNull { it.id == videoId }
    val mediaProgress = progress.filter {
        it.mediaType == item.type && it.mediaId == item.id
    }
    val exact = if (target != null) {
        mediaProgress.filter { progressMatchesVideo(it, target) }
    } else {
        mediaProgress.filter { it.videoId == videoId }
    }.maxByOrNull(ProgressSummary::updatedAt)
    exact?.playbackSource?.let { return it }

    if (item.type != "series" || target == null) return null
    val targetSeason = target.season ?: return null
    val targetEpisode = target.episode ?: return null
    return mediaProgress
        .filter { row ->
            row.playbackSource != null &&
                row.season != null &&
                row.episode != null &&
                (row.season < targetSeason ||
                    (row.season == targetSeason && row.episode < targetEpisode))
        }
        .maxWithOrNull(
            compareBy<ProgressSummary> { it.season ?: -1 }
                .thenBy { it.episode ?: -1 }
                .thenBy(ProgressSummary::updatedAt),
        )
        ?.playbackSource
}

internal fun latestCompletedProgress(
    progress: List<ProgressSummary>,
    item: CatalogItem,
    videos: List<VideoItem> = emptyList(),
): ProgressSummary? = progress
    .filter {
            it.mediaType == item.type && it.mediaId == item.id &&
            it.watched &&
            !it.videoId.startsWith(LegacyCompletionMarkerPrefix)
    }
    .maxWithOrNull(
        compareBy<ProgressSummary> {
            progressVideo(videos, it)?.season ?: it.season ?: -1
        }
            .thenBy {
                progressVideo(videos, it)?.episode ?: it.episode ?: -1
            }
            .thenBy { it.updatedAt }
            .thenBy { it.videoId },
    )

internal fun effectiveResumeVideoId(
    explicitVideoId: String?,
    progress: List<ProgressSummary>,
    item: CatalogItem,
): String? = explicitVideoId ?: latestUnfinishedProgress(progress, item)?.videoId

internal fun resolveRequestedVideo(
    videos: List<VideoItem>,
    requestedVideoId: String?,
    requestedProgress: ProgressSummary? = null,
): VideoItem? {
    requestedProgress?.let { progress ->
        if (progress.season != null && progress.episode != null) {
            return canonicalProgressVideo(videos, progress)
                ?: videos
                    .filter { it.season == progress.season }
                    .sortedWith(compareBy<VideoItem> { it.episode ?: 0 })
                    .firstOrNull()
                ?: seriesWatchVideos(videos).firstOrNull()
        }
        return progressVideo(videos, progress)
            ?: requestedVideoId?.let { id -> videos.firstOrNull { it.id == id } }
            ?: progress.season?.let { season ->
                videos
                    .filter { it.season == season }
                    .sortedWith(compareBy<VideoItem> { it.episode ?: 0 })
                    .firstOrNull()
            }
    }
    return requestedVideoId?.let { id -> videos.firstOrNull { it.id == id } }
        ?: videos.firstOrNull()
}

internal data class RequestedVideoSelection(
    val video: VideoItem?,
    val shouldResetPlayback: Boolean,
)

internal fun reconcileRequestedVideo(
    current: VideoItem?,
    videos: List<VideoItem>,
    requestedVideoId: String?,
    requestedProgress: ProgressSummary? = null,
): RequestedVideoSelection {
    val requested = resolveRequestedVideo(videos, requestedVideoId, requestedProgress)
    return RequestedVideoSelection(
        video = requested,
        shouldResetPlayback = current != null && current.id != requested?.id,
    )
}

internal fun detailsPlayLabel(
    item: CatalogItem,
    progress: ProgressSummary?,
    resumeVideo: VideoItem?,
): String {
    if (item.type != "series") {
        return if (progress != null && !progress.watched && progress.positionMs >= 1_000L) "Resume" else "Play"
    }

    val season = resumeVideo?.season
    val episode = resumeVideo?.episode
    val episodeLabel = if (season != null && episode != null) " S${season}E$episode" else ""
    val canResume = progress != null &&
        !progress.watched &&
        progress.positionMs >= 1_000L &&
        resumeVideo != null &&
        progressMatchesVideo(progress, resumeVideo)
    return (if (canResume) "Resume" else "Play") + episodeLabel
}

internal data class DetailsPlayTarget(
    val video: VideoItem?,
    val label: String,
)

internal fun detailsPlayTarget(
    item: CatalogItem,
    progress: List<ProgressSummary>,
    videos: List<VideoItem>,
    defaultVideoId: String? = null,
    today: String = Clock.System.now().toString().take(10),
): DetailsPlayTarget {
    val unfinished = latestUnfinishedProgress(progress, item)
    val resumeVideo = unfinished?.let { progressRow ->
        canonicalProgressVideo(videos, progressRow)
            ?: if (progressRow.season == null || progressRow.episode == null) {
                videos.firstOrNull { it.id == progressRow.videoId }
            } else {
                null
            }
    }
    val resumeFallback = unfinished?.season?.let { season ->
        videos
            .filter { it.season == season }
                .sortedWith(compareBy<VideoItem> { it.episode ?: 0 })
            .firstOrNull()
    }
    val completed = if (item.type == "series") latestCompletedProgress(progress, item, videos) else null
    val shouldResume = unfinished != null && (
        item.type != "series" || completed == null || unfinished.updatedAt > completed.updatedAt
    )
    val resolvedResumeVideo = resumeVideo ?: resumeFallback ?: if (shouldResume && item.type == "series") {
        seriesWatchVideos(videos, today).firstOrNull()
    } else {
        null
    }
    if (shouldResume && (item.type != "series" || resolvedResumeVideo != null)) {
        return DetailsPlayTarget(
            video = resolvedResumeVideo,
            label = detailsPlayLabel(item, unfinished, resolvedResumeVideo),
        )
    }

    if (item.type == "series") {
        val watchedVideoIds = progress
            .filter { it.mediaType == item.type && it.mediaId == item.id && it.watched }
            .mapTo(mutableSetOf(), ProgressSummary::videoId)
        val next = nextEpisodeAfter(
            progress = completed,
            videos = videos,
            watchedVideoIds = watchedVideoIds,
            today = today,
            watchedProgress = progress.filter { it.mediaType == item.type && it.mediaId == item.id },
        )
        if (next != null) {
            val season = next.season
            val episode = next.episode
            val label = if (season != null && episode != null) "Next Up • S${season}E$episode" else "Next Up"
            return DetailsPlayTarget(next, label)
        }
        if (completed != null) return DetailsPlayTarget(video = null, label = "Play")
    }

    val availableVideos = videos
        .filter { it.isReleasedOrAvailable(today) }
        .sortedWith(compareBy<VideoItem> { it.season ?: 0 }.thenBy { it.episode ?: 0 })
    val fallbackVideos = seriesWatchVideos(videos, today)
    val fallback = defaultVideoId?.let { id -> availableVideos.firstOrNull { it.id == id } }
        ?: fallbackVideos.firstOrNull()
    return DetailsPlayTarget(
        video = fallback,
        label = detailsPlayLabel(item, progress = null, resumeVideo = fallback),
    )
}
