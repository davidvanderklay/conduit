package media.conduit.mobile

import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.PlaybackQueueItem
import media.conduit.mobile.account.VideoItem

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

internal fun List<PlaybackQueueItem>.moveQueueItem(fromIndex: Int, toIndex: Int): List<PlaybackQueueItem> {
    if (fromIndex !in indices || toIndex !in indices || fromIndex == toIndex) return this
    val mutable = toMutableList()
    val item = mutable.removeAt(fromIndex)
    mutable.add(toIndex, item)
    return mutable
}
