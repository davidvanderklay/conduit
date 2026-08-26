package media.conduit.client.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import kotlinx.coroutines.test.runTest
import media.conduit.client.foundation.MemorySecureStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ProfileSyncRepositoryTest {
    @Test
    fun syncFailureKeepsTheCachedSnapshotAvailable() {
        val snapshot = ProfileSnapshot(
            profileId = "profile-1",
            addons = emptyList(),
            library = emptyList(),
            progress = emptyList(),
        )

        val state = profileSyncFailureState(snapshot, IllegalStateException("sync failed"))

        assertEquals(snapshot, state.snapshot)
        assertTrue(state.offline)
        assertEquals("sync failed", state.error)
    }

    @Test
    fun syncFailureKeepsTheLocalProgressProjectionWhenTheCacheIsUnavailable() = runTest {
        val progress = ProgressSummary(
            videoId = "show:1:1",
            mediaType = "series",
            mediaId = "show",
            name = "Show",
            positionMs = 10_000,
            durationMs = 60_000,
            watched = false,
            updatedAt = "2026-08-26T00:00:00Z",
        )
        val api = ConduitApi(HttpClient(MockEngine { error("offline") }))

        val state = ProfileSyncRepository(api, MemorySecureStore()).synchronize(
            baseUrl = "https://conduit.example",
            token = "token",
            profileId = "profile-1",
            preservedProgress = listOf(progress),
        )

        assertEquals(listOf(progress), state.snapshot?.progress)
        assertTrue(state.offline)
        assertEquals("offline", state.error)
    }
}
