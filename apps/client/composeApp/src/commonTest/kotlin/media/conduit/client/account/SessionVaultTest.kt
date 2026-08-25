package media.conduit.client.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Instant
import media.conduit.client.foundation.MemorySecureStore

class SessionVaultTest {
    @Test
    fun dropsExpiredPendingOAuthRequests() {
        val vault = SessionVault(MemorySecureStore())
        vault.savePendingOAuth(pending(expiresAt = "2026-08-10T12:00:00Z"))

        assertNull(vault.pendingOAuth("https://example.com", Instant.parse("2026-08-10T12:00:00Z")))
        assertNull(vault.pendingOAuth("https://example.com", Instant.parse("2026-08-10T11:00:00Z")))
    }

    @Test
    fun keepsPendingOAuthRequestsOutsideClockSkewMargin() {
        val vault = SessionVault(MemorySecureStore())
        val pending = pending(expiresAt = "2026-08-10T12:01:00Z")
        vault.savePendingOAuth(pending)

        assertEquals(
            pending,
            vault.pendingOAuth("https://example.com", Instant.parse("2026-08-10T12:00:00Z")),
        )
    }

    private fun pending(expiresAt: String) = PendingOAuth(
        serverBaseUrl = "https://example.com",
        requestId = "request",
        verifier = "verifier",
        authorizationUrl = "https://example.com/authorize",
        expiresAt = expiresAt,
    )
}
