package media.conduit.mobile

import kotlin.time.Clock
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

internal enum class PosterWatchState { Unwatched, Partial, Complete }
internal enum class EpisodeWatchState { NotStarted, InProgress, Watched }

private const val LegacyCompletionMarkerPrefix = "conduit:completion:"

internal fun episodeWatchState(progress: ProgressSummary?): EpisodeWatchState = when {
    progress?.watched == true -> EpisodeWatchState.Watched
    (progress?.positionMs ?: 0L) > 0L -> EpisodeWatchState.InProgress
    else -> EpisodeWatchState.NotStarted
}

internal fun episodeProgressFraction(progress: ProgressSummary?): Float =
    if (progress == null || progress.watched || progress.durationMs <= 0L) 0f
    else (progress.positionMs.toFloat() / progress.durationMs).coerceIn(0f, 1f)

internal fun posterWatchState(
    progress: List<ProgressSummary>,
    item: CatalogItem,
    episodeIds: List<String> = emptyList(),
): PosterWatchState {
    val mediaProgress = progress.filter {
        it.mediaType == item.type && it.mediaId == item.id &&
            !it.videoId.startsWith(LegacyCompletionMarkerPrefix)
    }
    if (item.type == "movie") {
        return if (mediaProgress.any { it.videoId == item.id && it.watched }) {
            PosterWatchState.Complete
        } else {
            PosterWatchState.Unwatched
        }
    }

    val watchedIds = mediaProgress.filter(ProgressSummary::watched).mapTo(mutableSetOf(), ProgressSummary::videoId)
    if (episodeIds.isNotEmpty() && episodeIds.all(watchedIds::contains)) return PosterWatchState.Complete
    return if (mediaProgress.any { it.watched || it.positionMs > 0 }) {
        PosterWatchState.Partial
    } else {
        PosterWatchState.Unwatched
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
): List<VideoItem> = videos
    .filter { it.season == season && it.releasedOrAvailable(today) }
    .sortedWith(compareBy<VideoItem> { it.episode ?: 0 }.thenBy(VideoItem::id))

internal fun seriesWatchVideos(
    videos: List<VideoItem>,
    today: String = Clock.System.now().toString().take(10),
): List<VideoItem> {
    val eligible = videos.filter { it.releasedOrAvailable(today) }
    val regular = eligible.filter { it.season != 0 }
    return (regular.ifEmpty { eligible }).sortedWith(
        compareBy<VideoItem> { it.season ?: 0 }
            .thenBy { it.episode ?: 0 }
            .thenBy(VideoItem::id),
    )
}

internal fun restOfSeasonWatchVideos(
    videos: List<VideoItem>,
    season: Int,
    fromVideoId: String,
    today: String = Clock.System.now().toString().take(10),
): List<VideoItem> {
    val eligible = seasonWatchVideos(videos, season, today)
    val start = eligible.indexOfFirst { it.id == fromVideoId }
    return if (start < 0) emptyList() else eligible.drop(start)
}

private fun VideoItem.releasedOrAvailable(today: String): Boolean {
    if (available == false) return false
    if (released == null) return true
    val releaseDate = released.take(10)
    return releaseDate.length != 10 || releaseDate <= today
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
            !it.watched && it.positionMs > 0
    }
    .maxByOrNull(ProgressSummary::updatedAt)

internal fun effectiveResumeVideoId(
    explicitVideoId: String?,
    progress: List<ProgressSummary>,
    item: CatalogItem,
): String? = explicitVideoId ?: latestUnfinishedProgress(progress, item)?.videoId

internal fun detailsPlayLabel(
    item: CatalogItem,
    progress: ProgressSummary?,
    resumeVideo: VideoItem?,
): String {
    if (progress == null || progress.watched || progress.positionMs <= 0) return "Play"
    if (item.type != "series") return "Resume"
    if (resumeVideo?.id != progress.videoId) return "Play"

    val season = resumeVideo.season
    val episode = resumeVideo.episode
    return if (season != null && episode != null) "Resume S${season}E$episode" else "Resume"
}
