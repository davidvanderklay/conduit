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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.Json
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
    fun registrationSurfacesServerValidationMessage() = runTest {
        val engine = MockEngine {
            respond(
                """{"code":"PASSWORD_TOO_SHORT","message":"Password is too short"}""",
                HttpStatusCode.UnprocessableEntity,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })

        val failure = assertFailsWith<ServerRequestException> {
            api.register("https://conduit.example", "alex@example.test", "short")
        }

        assertEquals(422, failure.statusCode)
        assertEquals("Password is too short", failure.message)
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
        val requestedProgressViews = mutableSetOf<String>()
        val engine = MockEngine { request ->
            if (!online) return@MockEngine respond("offline", HttpStatusCode.ServiceUnavailable)
            val body = when {
                request.url.encodedPath.endsWith("/addons") ->
                    """{"addons":[{"id":"a1","manifestId":"fixture","manifestUrl":"https://secret.example/manifest.json?token=private","manifest":{"id":"fixture","name":"Fixture"},"position":0,"enabled":true}]}"""
                request.url.encodedPath.endsWith("/library") ->
                    """{"items":[{"id":"movie:1","type":"movie","name":"A Movie","updatedAt":"2026-07-31T00:00:00Z"}]}"""
                request.url.encodedPath.endsWith("/progress") -> {
                    request.url.parameters["view"]?.let(requestedProgressViews::add)
                    """{"items":[{"videoId":"v1","mediaType":"movie","mediaId":"1","name":"A Movie","positionMs":1000,"durationMs":2000,"watched":false,"updatedAt":"2026-07-31T00:00:00Z"}]}"""
                }
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val client = HttpClient(engine) { install(ContentNegotiation) { json() } }
        val secure = MemorySecureStore()
        val repository = ProfileSyncRepository(ConduitApi(client), secure)

        val fresh = repository.synchronize("https://conduit.example", "token", "p1")
        assertEquals("A Movie", fresh.snapshot?.library?.single()?.name)
        assertEquals(setOf("history", "continue"), requestedProgressViews)
        assertTrue(fresh.offline.not())

        online = false
        val offline = repository.synchronize("https://conduit.example", "token", "p1")
        assertTrue(offline.offline)
        assertEquals("fixture", offline.snapshot?.addons?.single()?.manifestId)
    }

    @Test
    fun homeCatalogsUseManifestResourcePathsAndToleratePartialFailure() = runTest {
        val requested = mutableListOf<String>()
        val engine = MockEngine { request ->
            requested += request.url.encodedPath
            if (request.url.encodedPath.contains("series")) {
                respond("unavailable", HttpStatusCode.ServiceUnavailable)
            } else {
                respond(
                    """{"metas":[{"id":"tt1","type":"movie","name":"A Movie","poster":"https://img.example/poster.jpg"}]}""",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "application/json"),
                )
            }
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val addon = InstalledAddonSummary(
            id = "a1",
            manifestId = "fixture",
            manifestUrl = "https://addon.example/configured/manifest.json?secret=removed",
            manifest = kotlinx.serialization.json.Json.parseToJsonElement(
                """{"name":"Fixture","catalogs":[{"id":"popular","type":"movie","name":"Popular"},{"id":"popular","type":"series","name":"Series"}]}""",
            ).jsonObject,
            position = 0,
            enabled = true,
        )

        val result = api.loadHomeCatalogs(listOf(addon))

        assertEquals(listOf("/configured/catalog/movie/popular.json", "/configured/catalog/series/popular.json"), requested)
        assertEquals("A Movie", result.catalogs.single().items.single().name)
        assertEquals(1, result.failedRequests)
    }

    @Test
    fun metadataAndStreamsUseStremioResourcePaths() = runTest {
        val requested = mutableListOf<String>()
        val engine = MockEngine { request ->
            requested += request.url.encodedPath
            val body = when {
                request.url.encodedPath.contains("/meta/") ->
                    """{"meta":{"id":"tt1","type":"movie","name":"A Movie","description":"Details"}}"""
                request.url.encodedPath.contains("/stream/") ->
                    """{"streams":[{"url":"https://video.example/movie.mp4","name":"Direct"}]}"""
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val addon = InstalledAddonSummary(
            id = "a1", manifestId = "fixture",
            manifestUrl = "https://addon.example/config/manifest.json",
            manifest = kotlinx.serialization.json.Json.parseToJsonElement("""{"name":"Fixture","resources":["meta","stream"]}""").jsonObject,
            position = 0, enabled = true,
        )

        assertEquals("Details", api.loadMeta(listOf(addon), "movie", "tt1").description)
        assertEquals("Direct", api.loadStreams(listOf(addon), "movie", "tt1").single().stream.name)
        assertEquals(listOf("/config/meta/movie/tt1.json", "/config/stream/movie/tt1.json"), requested)
    }

    @Test
    fun streamParsingAcceptsProviderHeaderValuesAndNonNumericFileIndexes() = runTest {
        val engine = MockEngine {
            respond(
                """{"streams":[{"url":"https://video.example/live","fileIdx":"2","behaviorHints":{"proxyHeaders":{"request":{"Referer":"https://provider.example/","X-Flag":1}}}}]}""",
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } })
        val addon = InstalledAddonSummary(
            id = "a1", manifestId = "fixture", manifestUrl = "https://addon.example/manifest.json",
            manifest = Json.parseToJsonElement("""{"name":"Fixture","resources":["stream"]}""").jsonObject,
            position = 0, enabled = true,
        )

        val stream = api.loadStreams(listOf(addon), "movie", "tt1").single().stream
        assertEquals("https://video.example/live", stream.url)
        assertEquals("https://provider.example/", stream.behaviorHints?.proxyHeaders?.request?.get("Referer")?.jsonPrimitive?.content)
    }

    @Test
    fun mobileOAuthCorrelatesCallbackAndPersistsExchangedSession() = runTest {
        val engine = MockEngine { request ->
            val body = when (request.url.encodedPath) {
                "/v1/auth/mobile/start" ->
                    """{"requestId":"request-12345678901234567890123456789012","expiresAt":"2026-07-31T01:00:00Z","authorizationUrl":"https://conduit.example/v1/auth/mobile/authorize?request=abc"}"""
                "/v1/auth/mobile/exchange" ->
                    """{"token":"oauth-session","expiresAt":"2026-08-07T00:00:00Z"}"""
                "/v1/bootstrap" -> """{"households":[]}"""
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val vault = SessionVault(MemorySecureStore())
        val repository = AccountRepository(api, vault)
        val endpoint = ServerEndpoint("https://conduit.example", "conduit.example")
        val pending = repository.startOAuth(endpoint, PkcePair("v".repeat(43), "c".repeat(43)))

        val result = repository.completeOAuth(
            endpoint,
            "conduit://oauth/callback?request=${pending.requestId}&code=${"x".repeat(43)}",
        )
        assertIs<AccountStatus.SignedIn>(result)
        assertEquals("oauth-session", vault.loadFor(endpoint.baseUrl)?.token)
        assertEquals(null, vault.pendingOAuth(endpoint.baseUrl))
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
