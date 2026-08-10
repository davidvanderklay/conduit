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

    data class SetDismissed(
        val progress: ProgressSummary,
        val dismissed: Boolean,
    ) : ProfileMutation

    data class RemoveProgress(val progress: ProgressSummary) : ProfileMutation
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
        )
        copy(
            progress = progress.replaceProgress(optimistic),
            history = history.replaceProgress(optimistic),
            continueWatching = continueWatching.filterNot { it.videoId == optimistic.videoId },
        )
    }

    is ProfileMutation.SetDismissed -> {
        val optimistic = mutation.progress.copy(dismissed = mutation.dismissed)
        copy(
            progress = progress.replaceProgress(optimistic),
            history = history.replaceProgress(optimistic),
            continueWatching = if (mutation.dismissed) {
                continueWatching.filterNot { it.videoId == optimistic.videoId }
            } else {
                continueWatching.replaceProgress(optimistic)
            },
        )
    }

    is ProfileMutation.RemoveProgress -> copy(
        progress = progress.filterNot { it.videoId == mutation.progress.videoId },
        history = history.filterNot { it.videoId == mutation.progress.videoId },
        continueWatching = continueWatching.filterNot { it.videoId == mutation.progress.videoId },
    )
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
        is ProfileMutation.SetDismissed -> setProgressDismissed(
            baseUrl, token, profileId, mutation.progress.videoId, mutation.dismissed,
        )
        is ProfileMutation.RemoveProgress -> deleteProgress(
            baseUrl, token, profileId, mutation.progress.videoId,
        )
    }
}
