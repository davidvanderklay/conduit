package media.conduit.client.account

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
}
