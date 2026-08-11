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
    fun dismissKeepsHistoryAndRemovesContinueWatching() {
        val updated = snapshot.applyOptimistically(ProfileMutation.SetDismissed(progress, true))

        assertTrue(updated.history.single().dismissed)
        assertTrue(updated.continueWatching.isEmpty())
    }

    @Test
    fun libraryMutationCanBeReversedForUndo() {
        val saved = snapshot.applyOptimistically(ProfileMutation.SetLibrary(item, true))
        assertEquals("movie", saved.library.single().id)

        val removed = saved.applyOptimistically(ProfileMutation.SetLibrary(item, false))
        assertFalse(removed.library.any { it.id == item.id })
    }
}
