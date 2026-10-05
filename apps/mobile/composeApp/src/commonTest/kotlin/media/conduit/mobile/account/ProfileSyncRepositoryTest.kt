package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ProfileSyncRepositoryTest {
    @Test
    fun cancellationIsNeverAnOfflineState() {
        kotlin.test.assertFailsWith<kotlinx.coroutines.CancellationException> {
            profileSyncFailureState(null, kotlinx.coroutines.CancellationException("cancelled"))
        }
    }

    @Test
    fun authenticationAndServerErrorsAreNotReportedAsOffline() {
        val authentication = profileSyncFailureState(null, ServerRequestException("private", 401))
        val server = profileSyncFailureState(null, ServerRequestException("private", 503))
        assertEquals(SyncIssue.Authentication, authentication.issue)
        assertEquals(SyncIssue.Server, server.issue)
        kotlin.test.assertFalse(authentication.offline)
        kotlin.test.assertFalse(server.offline)
        kotlin.test.assertFalse("private" in server.error.orEmpty())
    }

    @Test
    fun syncFailureKeepsTheCachedSnapshotAvailable() {
        val snapshot = ProfileSnapshot(
            profileId = "profile-1",
            addons = emptyList(),
            library = emptyList(),
            progress = emptyList(),
        )

        val state = profileSyncFailureState(snapshot, kotlinx.io.IOException("sync failed"))

        assertEquals(snapshot, state.snapshot)
        assertTrue(state.offline)
        assertEquals("Unable to reach the server", state.error)
    }
}
