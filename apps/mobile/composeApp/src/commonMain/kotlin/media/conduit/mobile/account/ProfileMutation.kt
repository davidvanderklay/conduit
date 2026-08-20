package media.conduit.mobile.account

sealed interface ProfileMutation {
    data class SetLibrary(
        val item: CatalogItem,
        val saved: Boolean,
        val runtime: String? = null,
    ) : ProfileMutation

    data class SetWatched(
        val item: CatalogItem,
        val progress: ProgressSummary?,
        val video: VideoItem? = null,
        val watched: Boolean,
    ) : ProfileMutation

    data class SetSeriesWatched(
        val item: CatalogItem,
        val videos: List<VideoItem>,
        val progress: List<ProgressSummary>,
        val watched: Boolean,
    ) : ProfileMutation

    data class SetDismissed(
        val progress: ProgressSummary,
        val dismissed: Boolean,
    ) : ProfileMutation

    data class RemoveProgress(val progress: ProgressSummary) : ProfileMutation
    data class SetQueue(val items: List<PlaybackQueueItem>) : ProfileMutation
}

/** Removes playback acknowledgements invalidated by a successful profile mutation. */
internal fun acknowledgedProgressAfterMutation(
    acknowledged: Map<String, ProgressSummary>,
    mutation: ProfileMutation,
): Map<String, ProgressSummary> = when (mutation) {
    is ProfileMutation.SetLibrary -> acknowledged
    is ProfileMutation.SetWatched -> {
        val videoId = mutation.progress?.videoId ?: mutation.video?.id ?: mutation.item.id
        acknowledged - videoId
    }
    is ProfileMutation.SetSeriesWatched -> {
        val videoIds = mutation.videos
            .filter { video -> mutation.watched || mutation.progress.any { it.videoId == video.id } }
            .mapTo(mutableSetOf(), VideoItem::id)
        acknowledged.filterKeys { it !in videoIds }
    }
    is ProfileMutation.SetDismissed -> acknowledged.filterValues { progress ->
        progress.mediaType != mutation.progress.mediaType || progress.mediaId != mutation.progress.mediaId
    }
    is ProfileMutation.RemoveProgress -> acknowledged - mutation.progress.videoId
    is ProfileMutation.SetQueue -> acknowledged
}

fun ProfileSnapshot.applyOptimistically(mutation: ProfileMutation): ProfileSnapshot = when (mutation) {
    is ProfileMutation.SetLibrary -> copy(
        library = if (mutation.saved) {
            val optimistic = LibraryItemSummary(
                id = mutation.item.id,
                type = mutation.item.type,
                name = mutation.item.name,
                poster = mutation.item.poster,
                background = mutation.item.background,
                description = mutation.item.description,
                releaseInfo = mutation.item.releaseInfo,
                runtime = mutation.runtime,
                updatedAt = "9999-12-31T23:59:59Z",
            )
            listOf(optimistic) + library.filterNot { it.type == mutation.item.type && it.id == mutation.item.id }
        } else {
            library.filterNot { it.type == mutation.item.type && it.id == mutation.item.id }
        },
    )

    is ProfileMutation.SetWatched -> {
        val current = mutation.progress
        val optimistic = (current ?: ProgressSummary(
            videoId = mutation.video?.id ?: mutation.item.id,
            mediaType = mutation.item.type,
            mediaId = mutation.item.id,
            name = mutation.item.name,
            poster = mutation.item.poster,
            videoTitle = mutation.video?.title,
            season = mutation.video?.season,
            episode = mutation.video?.episode,
            positionMs = 0,
            durationMs = 0,
            watched = false,
            updatedAt = "",
        )).copy(
            watched = mutation.watched,
            positionMs = if (mutation.watched) current?.durationMs ?: 0 else 0,
            dismissed = false,
            continueWatching = mutation.watched,
        )
        copy(
            progress = progress.replaceProgress(optimistic),
            history = history.replaceProgress(optimistic),
            continueWatching = if (optimistic.continueWatching) {
                continueWatching.replaceProgress(optimistic)
            } else {
                continueWatching.filterNot { it.videoId == optimistic.videoId }
            },
        )
    }

    is ProfileMutation.SetSeriesWatched -> {
        val targetVideos = mutation.videos.filter { video ->
            mutation.watched || mutation.progress.any { it.videoId == video.id }
        }
        val optimistic = targetVideos.map { video ->
            val current = mutation.progress.firstOrNull { it.videoId == video.id }
            (current ?: ProgressSummary(
                videoId = video.id,
                mediaType = mutation.item.type,
                mediaId = mutation.item.id,
                name = mutation.item.name,
                poster = mutation.item.poster,
                videoTitle = video.title,
                season = video.season,
                episode = video.episode,
                positionMs = 0,
                durationMs = 0,
                watched = false,
                updatedAt = "",
            )).copy(
                watched = mutation.watched,
                positionMs = if (mutation.watched) current?.durationMs ?: 0 else 0,
                dismissed = false,
                continueWatching = mutation.watched,
            )
        }
        copy(
            progress = optimistic.fold(progress, List<ProgressSummary>::replaceProgress),
            history = optimistic.fold(history, List<ProgressSummary>::replaceProgress),
            continueWatching = optimistic.fold(continueWatching) { entries, item ->
                if (item.continueWatching) entries.replaceProgress(item)
                else entries.filterNot { it.videoId == item.videoId }
            },
        )
    }

    is ProfileMutation.SetDismissed -> {
        fun sameTitle(item: ProgressSummary): Boolean =
            item.mediaType == mutation.progress.mediaType && item.mediaId == mutation.progress.mediaId

        copy(
            progress = progress.map { item ->
                if (sameTitle(item)) item.copy(dismissed = mutation.dismissed) else item
            },
            history = history.map { item ->
                if (sameTitle(item)) item.copy(dismissed = mutation.dismissed) else item
            },
            continueWatching = if (mutation.dismissed) {
                continueWatching.filterNot(::sameTitle)
            } else {
                continueWatching.map { item ->
                    if (sameTitle(item)) item.copy(dismissed = false) else item
                }
            },
        )
    }

    is ProfileMutation.RemoveProgress -> copy(
        progress = progress.filterNot { it.videoId == mutation.progress.videoId },
        history = history.filterNot { it.videoId == mutation.progress.videoId },
        continueWatching = continueWatching.filterNot { it.videoId == mutation.progress.videoId },
    )
    is ProfileMutation.SetQueue -> copy(queue = mutation.items.distinctBy(PlaybackQueueItem::key))
}

private fun List<ProgressSummary>.replaceProgress(item: ProgressSummary): List<ProgressSummary> =
    listOf(item) + filterNot { it.videoId == item.videoId }

suspend fun ConduitApi.executeMutation(
    baseUrl: String,
    token: String,
    profileId: String,
    mutation: ProfileMutation,
) {
    when (mutation) {
        is ProfileMutation.SetLibrary -> if (mutation.saved) {
            saveLibraryItem(baseUrl, token, profileId, mutation.item, mutation.runtime)
        } else {
            removeLibraryItem(baseUrl, token, profileId, mutation.item.type, mutation.item.id)
        }
        is ProfileMutation.SetWatched -> setProgressWatched(
            baseUrl, token, profileId, mutation.progress, mutation.item, mutation.video, mutation.watched,
        )
        is ProfileMutation.SetSeriesWatched -> mutation.videos
            .filter { video -> mutation.watched || mutation.progress.any { it.videoId == video.id } }
            .forEach { video ->
            setProgressWatched(
                baseUrl,
                token,
                profileId,
                mutation.progress.firstOrNull { it.videoId == video.id },
                mutation.item,
                video,
                mutation.watched,
            )
        }
        is ProfileMutation.SetDismissed -> setProgressDismissed(
            baseUrl, token, profileId, mutation.progress.videoId, mutation.dismissed,
        )
        is ProfileMutation.RemoveProgress -> deleteProgress(
            baseUrl, token, profileId, mutation.progress.videoId,
        )
        is ProfileMutation.SetQueue -> replaceQueue(baseUrl, token, profileId, mutation.items)
    }
}
