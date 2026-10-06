package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import media.conduit.mobile.foundation.MemorySecureStore
import media.conduit.mobile.foundation.ServerEndpoint
import kotlin.test.*

class OfflineStartupTest {
    private val endpoint = ServerEndpoint("https://fixture.example", "fixture")

    @Test
    fun coldOfflineRestoreUsesEncryptedAccountShell() = runTest {
        val vault = SessionVault(MemorySecureStore())
        val session = StoredSession(endpoint.baseUrl, "fixture-token", "2099-01-01T00:00:00Z")
        val bootstrap = BootstrapResponse(listOf(HouseholdSummary("h", "Home", "owner", listOf(ProfileSummary("p", "David", false)))), AccountUser("fixture@example.com"))
        vault.save(session)
        vault.saveBootstrap(session, bootstrap)
        val api = ConduitApi(HttpClient(MockEngine { throw kotlinx.io.IOException("offline") }))
        val restored = assertIs<AccountStatus.SignedIn>(AccountRepository(api, vault).restore(endpoint))
        assertTrue(restored.cached)
        assertEquals(bootstrap, restored.bootstrap)
    }

    @Test
    fun confirmedRevocationCannotRestoreCachedAccount() = runTest {
        val vault = SessionVault(MemorySecureStore())
        val session = StoredSession(endpoint.baseUrl, "fixture-token", "2099-01-01T00:00:00Z")
        vault.save(session)
        vault.saveBootstrap(session, BootstrapResponse(emptyList()))
        val api = ConduitApi(HttpClient(MockEngine { request ->
            val body = when (request.url.encodedPath) {
                "/health" -> """{"status":"ok"}"""
                "/v1/auth/config" -> """{"needsOwner":false,"localRegistration":false,"oidc":{"enabled":false}}"""
                else -> "{}"
            }
            respond(body, if (request.url.encodedPath == "/v1/bootstrap") HttpStatusCode.Unauthorized else HttpStatusCode.OK,
                headersOf("Content-Type", "application/json"))
        }) { install(ContentNegotiation) { json() } })
        assertIs<AccountStatus.SignedOut>(AccountRepository(api, vault).restore(endpoint))
        assertNull(vault.cachedAccount(endpoint.baseUrl))
    }

    @Test
    fun profileRequestCancellationDoesNotPublishOrReplaceCache() = runTest {
        val secure = MemorySecureStore()
        val api = ConduitApi(HttpClient(MockEngine { throw CancellationException("obsolete profile") }))
        val repository = ProfileSyncRepository(api, secure)
        val snapshot = ProfileSnapshot("p", emptyList(), emptyList(), emptyList())
        repository.save(snapshot)
        assertFailsWith<CancellationException> { repository.synchronize(endpoint.baseUrl, "fixture-token", "p") }
        assertEquals(snapshot, repository.cached("p"))
        assertNull(repository.lastSyncedAt("p"))
        repository.savePendingQueue("p", emptyList())
        repository.clear("p")
        assertNull(repository.cached("p"))
        assertNull(repository.pendingQueue("p"))
    }
}
