package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.HttpMethod
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
    fun sessionRestoreIsBoundToItsServer() {
        val vault = SessionVault(MemorySecureStore())
        vault.save(StoredSession("https://first.example", "first-token"))

        assertEquals(null, vault.loadFor("https://second.example"))
        assertEquals("first-token", vault.loadFor("https://first.example")?.token)
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
        assertEquals(setOf("status", "history", "continue"), requestedProgressViews)
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
                """{"name":"Fixture","catalogs":[{"id":"popular","type":"movie","name":"Popular"},{"id":"popular","type":"series","name":"Series"},{"id":"featured","type":"movie","name":"Featured"},{"id":"featured","type":"series","name":"Featured Series"},{"id":"required","type":"movie","name":"Required","extra":[{"name":"search","isRequired":true}]}]}""",
            ).jsonObject,
            position = 0,
            enabled = true,
        )

        val result = api.loadHomeCatalogs(listOf(addon))

        assertEquals(
            listOf(
                "/configured/catalog/movie/popular.json",
                "/configured/catalog/series/popular.json",
                "/configured/catalog/movie/featured.json",
                "/configured/catalog/series/featured.json",
            ).sorted(),
            requested.sorted(),
        )
        assertEquals(2, result.catalogs.size)
        val popular = result.catalogs.first { it.catalogId == "popular" }
        assertEquals("A Movie", popular.items.single().name)
        assertEquals("a1", popular.addonId)
        assertEquals("movie", popular.type)
        assertEquals("Popular - Movie", popular.title)
        assertEquals(2, result.failedRequests)
    }

    @Test
    fun discoverCatalogsExposeFiltersAndCatalogRequestsEncodeExtras() = runTest {
        var requestedPath = ""
        val engine = MockEngine { request ->
            requestedPath = request.url.encodedPath
            respond(
                """{"metas":[{"id":"tt1","type":"movie","name":"A Movie"}]}""",
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val addon = InstalledAddonSummary(
            id = "a1",
            manifestId = "fixture",
            manifestUrl = "https://addon.example/config/manifest.json",
            manifest = Json.parseToJsonElement(
                """{"name":"Fixture","catalogs":[
                    {"id":"popular","type":"movie","name":"Popular","extra":[{"name":"genre","options":["Drama","Science Fiction"]}]},
                    {"id":"personal","type":"movie","extra":[{"name":"token","isRequired":true}]}
                ]}""",
            ).jsonObject,
            position = 0,
            enabled = true,
        )

        val catalog = discoverCatalogs(listOf(addon)).single()
        val items = api.loadCatalog(catalog, genre = "Science Fiction", skip = 20)

        assertTrue(catalog.supportsGenre)
        assertEquals(listOf("Drama", "Science Fiction"), catalog.genres)
        assertEquals("A Movie", items.single().name)
        assertEquals("/config/catalog/movie/popular/genre=Science%20Fiction&skip=20.json", requestedPath)
    }

    @Test
    fun profileMutationsUseExistingLibraryAndProgressRoutes() = runTest {
        val requests = mutableListOf<Pair<HttpMethod, String>>()
        val engine = MockEngine { request ->
            requests += request.method to request.url.encodedPath
            val body = when (request.method) {
                HttpMethod.Put -> if (request.url.encodedPath.contains("/library/")) {
                    """{"item":{"id":"movie","type":"movie","name":"Movie","updatedAt":"2026-08-09T00:00:00Z"}}"""
                } else {
                    """{"item":{"videoId":"movie","mediaType":"movie","mediaId":"movie","name":"Movie","positionMs":0,"durationMs":0,"watched":true,"updatedAt":"2026-08-09T00:00:00Z"}}"""
                }
                HttpMethod.Patch ->
                    """{"item":{"videoId":"movie","mediaType":"movie","mediaId":"movie","name":"Movie","positionMs":0,"durationMs":0,"watched":true,"updatedAt":"2026-08-09T00:00:00Z"}}"""
                HttpMethod.Delete -> ""
                else -> error("Unexpected method ${request.method}")
            }
            respond(body, if (request.method == HttpMethod.Delete) HttpStatusCode.NoContent else HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val item = CatalogItem("movie", "movie", "Movie")
        val progress = ProgressSummary("movie", "movie", "movie", "Movie", positionMs = 1, durationMs = 2, watched = false, updatedAt = "2026-01-01")

        api.saveLibraryItem("https://conduit.example", "token", "p1", item)
        api.setProgressWatched("https://conduit.example", "token", "p1", progress, item, null, true)
        api.setProgressDismissed("https://conduit.example", "token", "p1", "movie", true)
        api.deleteProgress("https://conduit.example", "token", "p1", "movie")

        assertEquals(
            listOf(
                HttpMethod.Put to "/v1/profiles/p1/library/movie/movie",
                HttpMethod.Patch to "/v1/profiles/p1/progress/movie",
                HttpMethod.Patch to "/v1/profiles/p1/progress/movie",
                HttpMethod.Delete to "/v1/profiles/p1/progress/movie",
            ),
            requests,
        )
    }

    @Test
    fun dismissProgressAcceptsAnEmptySuccessResponse() = runTest {
        val engine = MockEngine {
            respond("", HttpStatusCode.NoContent)
        }
        val api = ConduitApi(HttpClient(engine))

        api.setProgressDismissed("https://conduit.example", "token", "p1", "movie", true)
    }

    @Test
    fun metadataAndStreamsUseStremioResourcePaths() = runTest {
        val requested = mutableListOf<String>()
        val engine = MockEngine { request ->
            requested += request.url.encodedPath
            val body = when {
                request.url.encodedPath.contains("/meta/") ->
                    """{"meta":{"id":"tt1","type":"movie","name":"A Movie","description":"Details","writer":["A Writer"],"country":"US","trailerStreams":[{"youtubeId":"trailer-id"}]}}"""
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

        val metadata = api.loadMeta(listOf(addon), "movie", "tt1")
        assertEquals("Details", metadata.description)
        assertEquals(listOf("A Writer"), metadata.writer)
        assertEquals("US", metadata.country)
        assertEquals("trailer-id", metadata.trailerStreams.single().youtubeId)
        assertEquals("Direct", api.loadStreams(listOf(addon), "movie", "tt1").single().stream.name)
        assertEquals(listOf("/config/meta/movie/tt1.json", "/config/stream/movie/tt1.json"), requested)
    }

    @Test
    fun metadataNormalizesNullAndScalarCreditFields() = runTest {
        val engine = MockEngine {
            respond(
                """{"meta":{
                    "id":"series:sg1",
                    "type":"series",
                    "name":"Stargate SG-1",
                    "director":null,
                    "cast":"Richard Dean Anderson",
                    "writer":["Writer A",null,"  "],
                    "description":"  ",
                    "country":" ",
                    "awards":"  ",
                    "genres":null,
                    "trailers":null,
                    "trailerStreams":null,
                    "videos":null
                }}""",
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val addon = InstalledAddonSummary(
            id = "cinemeta",
            manifestId = "cinemeta",
            manifestUrl = "https://addon.example/manifest.json",
            manifest = Json.parseToJsonElement(
                """{"name":"Cinemeta","resources":["meta"]}""",
            ).jsonObject,
            position = 0,
            enabled = true,
        )

        val metadata = api.loadMeta(listOf(addon), "series", "series:sg1")

        assertEquals(emptyList<String>(), metadata.director)
        assertEquals(listOf("Richard Dean Anderson"), metadata.cast)
        assertEquals(listOf("Writer A"), metadata.writer)
        assertEquals(null, metadata.description)
        assertEquals(null, metadata.country)
        assertEquals(null, metadata.awards)
        assertEquals(emptyList<String>(), metadata.genres)
        assertTrue(metadata.trailers.isEmpty())
        assertTrue(metadata.trailerStreams.isEmpty())
        assertTrue(metadata.videos.isEmpty())
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
        var exchangeAttempts = 0
        val engine = MockEngine { request ->
            val body = when (request.url.encodedPath) {
                "/v1/auth/mobile/start" ->
                    """{"requestId":"request-12345678901234567890123456789012","expiresAt":"2099-07-31T01:00:00Z","authorizationUrl":"https://conduit.example/v1/auth/mobile/authorize?request=abc"}"""
                "/v1/auth/mobile/exchange" -> {
                    exchangeAttempts += 1
                    """{"token":"oauth-session","expiresAt":"2099-08-07T00:00:00Z"}"""
                }
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
        assertIs<AccountStatus.Error>(
            repository.completeOAuth(
                endpoint,
                "conduit://oauth/callback?request=${pending.requestId}&code=${"x".repeat(43)}",
            ),
        )
        assertEquals(1, exchangeAttempts)
    }

    @Test
    fun transientOAuthExchangeFailureKeepsPendingRequestForRetry() = runTest {
        var exchangeAttempts = 0
        val engine = MockEngine { request ->
            when (request.url.encodedPath) {
                "/v1/auth/mobile/start" -> respond(
                    """{"requestId":"request-transient","expiresAt":"2026-08-31T01:00:00Z","authorizationUrl":"https://conduit.example/auth"}""",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "application/json"),
                )
                "/v1/auth/mobile/exchange" -> {
                    exchangeAttempts += 1
                    respond("temporary", HttpStatusCode.ServiceUnavailable)
                }
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val vault = SessionVault(MemorySecureStore())
        val repository = AccountRepository(api, vault)
        val endpoint = ServerEndpoint("https://conduit.example", "conduit.example")
        val pending = repository.startOAuth(endpoint, PkcePair("v".repeat(43), "c".repeat(43)))

        assertIs<AccountStatus.Error>(
            repository.completeOAuth(
                endpoint,
                "conduit://oauth/callback?request=${pending.requestId}&code=${"x".repeat(43)}",
            ),
        )
        assertEquals(1, exchangeAttempts)
        assertTrue(repository.hasPendingOAuth(endpoint.baseUrl))
    }

    @Test
    fun expiredSessionIsClearedOnlyAfterConfirmedUnauthorizedBootstrap() = runTest {
        val engine = MockEngine { request ->
            when (request.url.encodedPath) {
                "/health" -> respond(
                    """{"status":"ok"}""",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "application/json"),
                )
                "/v1/auth/config" -> respond(
                    """{"needsOwner":false,"localRegistration":false,"oidc":{"enabled":false}}""",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "application/json"),
                )
                "/v1/bootstrap" -> respond("expired", HttpStatusCode.Unauthorized)
                else -> error("Unexpected path ${request.url.encodedPath}")
            }
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val vault = SessionVault(MemorySecureStore())
        val endpoint = ServerEndpoint("https://conduit.example", "conduit.example")
        vault.save(StoredSession(endpoint.baseUrl, "expired-session"))

        val result = AccountRepository(api, vault).restore(endpoint)

        assertIs<AccountStatus.SignedOut>(result)
        assertEquals(null, vault.loadFor(endpoint.baseUrl))
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
