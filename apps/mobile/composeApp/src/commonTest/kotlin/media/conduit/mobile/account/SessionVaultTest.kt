package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Instant
import media.conduit.mobile.foundation.MemorySecureStore

class SessionVaultTest {
    @Test
    fun offlineShellRequiresMatchingServerTokenAndUnexpiredSession() {
        val vault = SessionVault(MemorySecureStore())
        val session = StoredSession("https://example.com", "first", "2026-08-10T12:01:00Z")
        val bootstrap = BootstrapResponse(emptyList(), AccountUser("first@example.com"))
        vault.save(session)
        vault.saveBootstrap(session, bootstrap)
        val now = Instant.parse("2026-08-10T12:00:00Z")
        assertEquals(bootstrap, vault.cachedAccount(session.serverBaseUrl, now)?.bootstrap)
        assertNull(vault.cachedAccount("https://other.example", now))
        assertNull(vault.cachedAccount(session.serverBaseUrl, Instant.parse("2026-08-10T12:02:00Z")))
        vault.save(session.copy(token = "second"))
        assertNull(vault.cachedAccount(session.serverBaseUrl, now))
        vault.save(session.copy(expiresAt = null))
        assertNull(vault.cachedAccount(session.serverBaseUrl, now))
        vault.clear()
        assertNull(vault.cachedAccount(session.serverBaseUrl, now))
    }

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
