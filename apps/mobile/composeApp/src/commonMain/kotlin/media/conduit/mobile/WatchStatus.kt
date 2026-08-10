package media.conduit.mobile

import kotlin.time.Clock
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.VideoItem

internal enum class PosterWatchState { Unwatched, Partial, Complete }

private const val LegacyCompletionMarkerPrefix = "conduit:completion:"

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
): List<String> {
    val regularEpisodes = videos.filter { video ->
        video.season != 0 && video.releasedOrAvailable(today)
    }
    return (regularEpisodes.ifEmpty { videos }).map(VideoItem::id)
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
