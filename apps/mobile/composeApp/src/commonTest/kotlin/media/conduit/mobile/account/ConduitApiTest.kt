package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.test.assertIs
import kotlinx.coroutines.test.runTest
import media.conduit.mobile.foundation.MemorySecureStore
import media.conduit.mobile.foundation.ServerEndpoint

class ConduitApiTest {
    @Test
    fun validatesHealthAndAuthenticationConfiguration() = runTest {
        val client = mockClient { path, _ ->
            when (path) {
                "/health" -> """{"status":"ok"}"""
                "/v1/auth/config" ->
                    """{"needsOwner":false,"localRegistration":false,"oidc":{"enabled":true,"provider":"google","displayName":"Continue with Google"}}"""
                else -> error("Unexpected path $path")
            }
        }

        val result = ConduitApi(client).validate("https://conduit.example")
        assertTrue(result.authentication.oidc.enabled)
        assertEquals("google", result.authentication.oidc.provider)
    }

    @Test
    fun bootstrapSendsBearerOnlyToSelectedServerRequest() = runTest {
        var authorization: String? = null
        val client = mockClient { _, header ->
            authorization = header
            """{"households":[{"id":"home","name":"Home","role":"owner","profiles":[{"id":"p1","name":"Alex","isKids":false}]}]}"""
        }

        val result = ConduitApi(client).bootstrap("https://conduit.example", "session-secret")
        assertEquals("Bearer session-secret", authorization)
        assertEquals("Alex", result.households.single().profiles.single().name)
    }

    @Test
    fun rejectsUnexpectedHealthResponse() = runTest {
        val client = mockClient { _, _ -> """{"status":"starting"}""" }
        assertFailsWith<ServerRequestException> {
            ConduitApi(client).validate("https://conduit.example")
        }
    }

    @Test
    fun signInCapturesBearerAndRepositoryRestoresBootstrap() = runTest {
        val engine = MockEngine { request ->
            val content = when (request.url.encodedPath) {
                "/api/auth/sign-in/email" -> "{}"
                "/health" -> """{"status":"ok"}"""
                "/v1/auth/config" ->
                    """{"needsOwner":false,"localRegistration":false,"oidc":{"enabled":false}}"""
                "/v1/bootstrap" ->
                    """{"households":[{"id":"home","name":"Home","role":"owner","profiles":[{"id":"p1","name":"Alex","isKids":false}]}]}"""
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
            val headers = if (request.url.encodedPath == "/api/auth/sign-in/email") {
                headersOf(
                    HttpHeaders.ContentType to listOf("application/json"),
                    "set-auth-token" to listOf("signed-session"),
                )
            } else {
                headersOf(HttpHeaders.ContentType, "application/json")
            }
            respond(content, HttpStatusCode.OK, headers)
        }
        val api = ConduitApi(
            HttpClient(engine) { install(ContentNegotiation) { json() } },
        )
        val vault = SessionVault(MemorySecureStore())
        val repository = AccountRepository(api, vault)
        val endpoint = ServerEndpoint("https://conduit.example", "conduit.example")
        val auth = AuthenticationConfiguration(false, false, OidcConfiguration(false))

        val signedIn = repository.signIn(endpoint, auth, "alex@example.test", "password")
        assertIs<AccountStatus.SignedIn>(signedIn)
        assertEquals("signed-session", vault.loadFor(endpoint.baseUrl)?.token)

        val restored = repository.restore(endpoint)
        assertIs<AccountStatus.SignedIn>(restored)
        assertEquals("Alex", restored.bootstrap.households.single().profiles.single().name)
    }

    @Test
    fun offlineRestoreRetainsEncryptedSession() = runTest {
        val engine = MockEngine {
            respond("unavailable", HttpStatusCode.ServiceUnavailable)
        }
        val api = ConduitApi(HttpClient(engine))
        val vault = SessionVault(MemorySecureStore())
        val endpoint = ServerEndpoint("https://offline.example", "offline.example")
        vault.save(StoredSession(endpoint.baseUrl, "keep-this-token"))

        assertIs<AccountStatus.Error>(AccountRepository(api, vault).restore(endpoint))
        assertEquals("keep-this-token", vault.loadFor(endpoint.baseUrl)?.token)
    }

    @Test
    fun profileSyncCachesSensitiveAddonConfigurationForOfflineUse() = runTest {
        var online = true
        val engine = MockEngine { request ->
            if (!online) return@MockEngine respond("offline", HttpStatusCode.ServiceUnavailable)
            val body = when {
                request.url.encodedPath.endsWith("/addons") ->
                    """{"addons":[{"id":"a1","manifestId":"fixture","manifestUrl":"https://secret.example/manifest.json?token=private","manifest":{"id":"fixture","name":"Fixture"},"position":0,"enabled":true}]}"""
                request.url.encodedPath.endsWith("/library") ->
                    """{"items":[{"id":"movie:1","type":"movie","name":"A Movie","updatedAt":"2026-07-31T00:00:00Z"}]}"""
                request.url.encodedPath.endsWith("/progress") ->
                    """{"items":[{"videoId":"v1","mediaType":"movie","mediaId":"1","name":"A Movie","positionMs":1000,"durationMs":2000,"watched":false,"updatedAt":"2026-07-31T00:00:00Z"}]}"""
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val client = HttpClient(engine) { install(ContentNegotiation) { json() } }
        val secure = MemorySecureStore()
        val repository = ProfileSyncRepository(ConduitApi(client), secure)

        val fresh = repository.synchronize("https://conduit.example", "token", "p1")
        assertEquals("A Movie", fresh.snapshot?.library?.single()?.name)
        assertTrue(fresh.offline.not())

        online = false
        val offline = repository.synchronize("https://conduit.example", "token", "p1")
        assertTrue(offline.offline)
        assertEquals("fixture", offline.snapshot?.addons?.single()?.manifestId)
    }

    private fun mockClient(response: (path: String, authorization: String?) -> String): HttpClient {
        val engine = MockEngine { request ->
            respond(
                content = response(request.url.encodedPath, request.headers[HttpHeaders.Authorization]),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        return HttpClient(engine) { install(ContentNegotiation) { json() } }
    }
}
