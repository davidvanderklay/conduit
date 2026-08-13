package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProfileMutationTest {
    private val item = CatalogItem("movie", "movie", "Movie")
    private val progress = ProgressSummary(
        videoId = "movie",
        mediaType = "movie",
        mediaId = "movie",
        name = "Movie",
        positionMs = 45_000,
        durationMs = 100_000,
        watched = false,
        continueWatching = true,
        updatedAt = "2026-01-01",
    )
    private val snapshot = ProfileSnapshot(
        profileId = "profile",
        addons = emptyList(),
        library = emptyList(),
        progress = listOf(progress),
        history = listOf(progress),
        continueWatching = listOf(progress),
    )

    @Test
    fun watchedMutationUpdatesEveryProgressView() {
        val updated = snapshot.applyOptimistically(ProfileMutation.SetWatched(item, progress, watched = true))

        assertTrue(updated.progress.single().watched)
        assertTrue(updated.history.single().watched)
        assertTrue(updated.continueWatching.single().watched)
        assertTrue(updated.continueWatching.single().continueWatching)
    }

    @Test
    fun seriesMutationUpdatesEveryReleasedEpisode() {
        val series = CatalogItem("show", "series", "Show")
        val first = ProgressSummary(
            videoId = "s1e1",
            mediaType = "series",
            mediaId = "show",
            name = "Show",
            positionMs = 10_000,
            durationMs = 40_000,
            watched = false,
            updatedAt = "2026-01-01",
        )
        val base = snapshot.copy(progress = listOf(first), history = listOf(first), continueWatching = emptyList())
        val videos = listOf(
            VideoItem("s1e1", title = "One", season = 1, episode = 1),
            VideoItem("s1e2", title = "Two", season = 1, episode = 2),
        )

        val updated = base.applyOptimistically(
            ProfileMutation.SetSeriesWatched(series, videos, listOf(first), watched = true),
        )

        assertEquals(setOf("s1e1", "s1e2"), updated.progress.map { it.videoId }.toSet())
        assertTrue(updated.progress.all { it.watched })
        assertTrue(updated.history.all { it.watched })
    }

    @Test
    fun unwatchedSeriesMutationDoesNotCreateUntouchedRows() {
        val series = CatalogItem("show", "series", "Show")
        val first = ProgressSummary(
            videoId = "s1e1",
            mediaType = "series",
            mediaId = "show",
            name = "Show",
            positionMs = 10_000,
            durationMs = 40_000,
            watched = true,
            updatedAt = "2026-01-01",
        )
        val videos = listOf(
            VideoItem("s1e1", title = "One", season = 1, episode = 1),
            VideoItem("s1e2", title = "Two", season = 1, episode = 2),
        )

        val updated = snapshot.copy(
            progress = listOf(first),
            history = listOf(first),
            continueWatching = listOf(first),
        ).applyOptimistically(
            ProfileMutation.SetSeriesWatched(series, videos, listOf(first), watched = false),
        )

        assertEquals(listOf("s1e1"), updated.progress.map { it.videoId })
        assertFalse(updated.progress.single().watched)
        assertTrue(updated.continueWatching.isEmpty())
    }

    @Test
    fun dismissKeepsHistoryAndRemovesContinueWatching() {
        val updated = snapshot.applyOptimistically(ProfileMutation.SetDismissed(progress, true))

        assertTrue(updated.history.single().dismissed)
        assertTrue(updated.continueWatching.isEmpty())
    }

    @Test
    fun playbackSaveReplacesProgressAcrossAllProfileViews() {
        val saved = progress.copy(
            positionMs = 80_000,
            updatedAt = "2026-08-13",
        )

        val updated = snapshot.withProgressUpdate(saved)

        assertEquals(saved, updated.progress.single())
        assertEquals(saved, updated.history.single())
        assertEquals(saved, updated.continueWatching.single())
    }

    @Test
    fun libraryMutationCanBeReversedForUndo() {
        val saved = snapshot.applyOptimistically(ProfileMutation.SetLibrary(item, true))
        assertEquals("movie", saved.library.single().id)

        val removed = saved.applyOptimistically(ProfileMutation.SetLibrary(item, false))
        assertFalse(removed.library.any { it.id == item.id })
    }
}
