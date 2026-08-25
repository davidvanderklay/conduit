package media.conduit.client

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.client.account.ProgressSummary

class ProgressPersistenceTest {
    @Test
    fun loadingSnapshotPreservesExistingProgressAndWatchState() {
        val existing = progress(positionMs = 420_000, durationMs = 1_000_000, watched = false)

        val resolved = requireNotNull(resolveProgressState(
            PlaybackState(loading = true, positionMs = 0, durationMs = 0),
            existing,
        ))

        assertEquals(420_000, resolved.positionMs)
        assertEquals(1_000_000, resolved.durationMs)
        assertEquals(false, resolved.watched)
    }

    @Test
    fun loadingSnapshotPreservesAPreviouslyWatchedItem() {
        val existing = progress(positionMs = 1_000_000, durationMs = 1_000_000, watched = true)

        val resolved = requireNotNull(resolveProgressState(
            PlaybackState(loading = true),
            existing,
        ))

        assertEquals(1_000_000, resolved.positionMs)
        assertEquals(1_000_000, resolved.durationMs)
        assertEquals(true, resolved.watched)
    }

    @Test
    fun validSnapshotUsesCurrentTimingAndLetsServerClassifyCompletion() {
        val resolved = requireNotNull(resolveProgressState(
            PlaybackState(loading = false, positionMs = 450_000, durationMs = 1_000_000),
            progress(positionMs = 420_000, durationMs = 1_000_000, watched = false),
        ))

        assertEquals(450_000, resolved.positionMs)
        assertEquals(1_000_000, resolved.durationMs)
        assertEquals(null, resolved.watched)
    }

    @Test
    fun loadingSnapshotWithoutExistingProgressIsNotPersisted() {
        assertEquals(null, resolveProgressState(PlaybackState(loading = true), existing = null))
    }

    private fun progress(positionMs: Long, durationMs: Long, watched: Boolean) = ProgressSummary(
        videoId = "video",
        mediaType = "series",
        mediaId = "series",
        name = "Series",
        positionMs = positionMs,
        durationMs = durationMs,
        watched = watched,
        updatedAt = "2026-01-01",
    )
}
