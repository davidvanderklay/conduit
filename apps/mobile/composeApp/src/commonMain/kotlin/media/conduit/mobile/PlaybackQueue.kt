package media.conduit.mobile

import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.PlaybackQueueItem
import media.conduit.mobile.account.VideoItem

internal fun canQueueEpisode(video: VideoItem, today: String): Boolean = video.isReleasedOrAvailable(today)

internal fun playbackQueueItem(item: CatalogItem, video: VideoItem? = null): PlaybackQueueItem? {
    if (item.type == "series" && video == null) return null
    return PlaybackQueueItem(
        mediaType = item.type,
        mediaId = item.id,
        videoId = video?.id ?: item.id,
        name = item.name,
        poster = item.poster,
        artwork = item.background,
        videoTitle = video?.title ?: video?.name,
        season = video?.season,
        episode = video?.episode,
    )
}

internal fun List<PlaybackQueueItem>.addToQueue(item: PlaybackQueueItem): List<PlaybackQueueItem> =
    if (any { it.key == item.key }) this else this + item

internal fun List<PlaybackQueueItem>.moveToQueueFront(item: PlaybackQueueItem): List<PlaybackQueueItem> =
    listOf(item) + filterNot { it.key == item.key }

internal fun List<PlaybackQueueItem>.removeFromQueue(key: String): List<PlaybackQueueItem> =
    filterNot { it.key == key }

internal fun queueAfterPlaybackStarted(
    queue: List<PlaybackQueueItem>,
    mediaId: String,
    videoId: String,
): List<PlaybackQueueItem> = queue.filterNot { it.mediaId == mediaId && it.videoId == videoId }

internal fun nextQueuedItem(
    queue: List<PlaybackQueueItem>,
    mediaId: String,
    videoId: String,
): PlaybackQueueItem? = queue.firstOrNull { it.mediaId != mediaId || it.videoId != videoId }

internal data class PlaybackUpNext(
    val nextEpisodeTitle: String?,
    val nextEpisodeArtwork: String?,
    val nextItemQueued: Boolean,
    val queuedItem: PlaybackQueueItem? = null,
)

internal fun playbackUpNext(
    request: PlaybackRequest,
    queue: List<PlaybackQueueItem>,
): PlaybackUpNext? {
    val queued = nextQueuedItem(queue, request.identity.mediaId, request.identity.videoId)
    if (queued != null) {
        val title = if (queued.mediaType == "movie") {
            queued.name
        } else {
            listOfNotNull(
                queued.name,
                queued.season?.let { season -> "S${season}E${queued.episode ?: 0}" },
                queued.videoTitle,
            ).joinToString(" · ")
        }
        return PlaybackUpNext(title, queued.artwork ?: queued.poster, true, queued)
    }

    return if (request.hasNextEpisode) {
        PlaybackUpNext(request.nextEpisodeTitle, request.nextEpisodeArtwork, false)
    } else {
        null
    }
}

internal fun List<PlaybackQueueItem>.moveQueueItem(fromIndex: Int, toIndex: Int): List<PlaybackQueueItem> {
    if (fromIndex !in indices || toIndex !in indices || fromIndex == toIndex) return this
    val mutable = toMutableList()
    val item = mutable.removeAt(fromIndex)
    mutable.add(toIndex, item)
    return mutable
}
