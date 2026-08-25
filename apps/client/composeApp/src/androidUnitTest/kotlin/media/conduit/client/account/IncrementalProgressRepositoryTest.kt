package media.conduit.client.account

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import media.conduit.client.progressdb.ProgressDatabase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class IncrementalProgressRepositoryTest {
    @Test
    fun retryAfterRepositoryRestartUsesTheSameOperationId() = runTest {
        val database = database()
        val requestBodies = mutableListOf<String>()
        val api = api(requestBodies)
        val first = IncrementalProgressRepository(api, database)
        val operationId = first.enqueue(Server, Account, Profile, upsert())

        IncrementalProgressRepository(api, database).synchronize(Server, "token", Account, Profile)

        val sentId = Json.parseToJsonElement(requestBodies.single()).jsonObject
            .getValue("operationId").jsonPrimitive.content
        assertEquals(operationId, sentId)
    }

    @Test
    fun offlineDismissalSupersedesOlderProgressAndSurvivesRestart() = runTest {
        val database = database()
        val requestBodies = mutableListOf<String>()
        val api = api(requestBodies)
        val first = IncrementalProgressRepository(api, database)
        first.enqueue(Server, Account, Profile, upsert())
        first.enqueue(
            Server,
            Account,
            Profile,
            ProgressOperation.DismissTitle(ProgressIdentity("series", "kitsu:1")),
        )

        IncrementalProgressRepository(api, database).synchronize(Server, "token", Account, Profile)

        assertEquals(1, requestBodies.size)
        val operation = Json.parseToJsonElement(requestBodies.single()).jsonObject
            .getValue("operation").jsonObject
        assertEquals("dismissTitle", operation.getValue("type").jsonPrimitive.content)
    }

    @Test
    fun accountScopesNeverReplayEachOthersOperations() = runTest {
        val database = database()
        val requestBodies = mutableListOf<String>()
        val repository = IncrementalProgressRepository(api(requestBodies), database)
        repository.enqueue(Server, "account-a", Profile, upsert())
        repository.enqueue(Server, "account-b", Profile, ProgressOperation.DismissTitle(ProgressIdentity("series", "kitsu:2")))

        repository.synchronize(Server, "token", "account-a", Profile)

        assertEquals(1, requestBodies.size)
        assertEquals(1, repository.diagnostics(Server, "account-b", Profile).size)
    }

    @Test
    fun malformedPersistedProjectionDoesNotCrashSynchronization() = runTest {
        val database = database()
        val scope = scopeKey(Server, Account, Profile)
        database.progressQueries.upsertScope(scope, generation = 1, cursor = 0, initialized = 1)
        database.progressQueries.upsertProjection(scope, "s1:e1", "title-1", 1, "not-json")

        val repository = IncrementalProgressRepository(api(mutableListOf()), database)
        val progress = repository.synchronize(Server, "token", Account, Profile)

        assertTrue(progress.isEmpty())
    }

    @Test
    fun projectionIsOrderedByMostRecentActivityForHistory() = runTest {
        val database = database()
        val scope = scopeKey(Server, Account, Profile)
        val older = ProgressSummary(
            videoId = "show:1:1",
            mediaType = "series",
            mediaId = "show",
            name = "Show",
            videoTitle = "Older episode",
            season = 1,
            episode = 1,
            positionMs = 60_000,
            durationMs = 60_000,
            watched = true,
            updatedAt = "2026-08-23T08:00:00Z",
            canonicalTitleId = "title-1",
            canonicalEpisodeKey = "s1:e1",
            revision = 1,
        )
        val newer = older.copy(
            videoId = "show:1:2",
            videoTitle = "Newer episode",
            episode = 2,
            updatedAt = "2026-08-23T09:00:00Z",
            canonicalEpisodeKey = "s1:e2",
            revision = 2,
        )
        val json = Json { encodeDefaults = true; explicitNulls = false }
        database.progressQueries.upsertScope(scope, generation = 1, cursor = 0, initialized = 1)
        database.progressQueries.upsertProjection(scope, "s1:e1", "title-1", 1, json.encodeToString(older))
        database.progressQueries.upsertProjection(scope, "s1:e2", "title-1", 2, json.encodeToString(newer))

        val progress = IncrementalProgressRepository(api(mutableListOf()), database)
            .synchronize(Server, "token", Account, Profile)

        assertEquals(listOf("show:1:2", "show:1:1"), progress.map(ProgressSummary::videoId))
    }

    private fun database(): ProgressDatabase {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        ProgressDatabase.Schema.create(driver)
        return ProgressDatabase(driver)
    }

    private fun api(requestBodies: MutableList<String>): ConduitApi {
        var revision = 0
        val engine = MockEngine { request ->
            when {
                request.url.encodedPath.endsWith("/operations") -> {
                    requestBodies += (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
                    revision += 1
                    respond(
                        """{"accepted":true,"generation":1,"revision":$revision,"event":{"revision":$revision,"type":"test","payload":{"kind":"dismissTitle","canonicalTitleId":"title-1"}}}""",
                        HttpStatusCode.OK,
                        headersOf("Content-Type", ContentType.Application.Json.toString()),
                    )
                }
                request.url.encodedPath.endsWith("/snapshot") -> respond(
                    """{"generation":1,"boundary":$revision,"items":[],"nextAfterVideoId":null}""",
                    HttpStatusCode.OK,
                    headersOf("Content-Type", ContentType.Application.Json.toString()),
                )
                request.url.encodedPath.endsWith("/changes") -> respond(
                    """{"generation":1,"events":[],"nextCursor":$revision,"hasMore":false}""",
                    HttpStatusCode.OK,
                    headersOf("Content-Type", ContentType.Application.Json.toString()),
                )
                else -> error("Unexpected request ${request.url}")
            }
        }
        return ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
    }

    private fun scopeKey(baseUrl: String, accountId: String, profileId: String): String =
        listOf(baseUrl, accountId, profileId).joinToString("\u001f") { "${it.length}:$it" }

    private fun upsert() = ProgressOperation.Upsert(
        identity = ProgressIdentity("series", "kitsu:1", videoId = "kitsu:1:1:1", season = 1, episode = 1),
        name = "Show",
        positionMs = 10_000,
        durationMs = 60_000,
        watched = false,
        checkpointSessionId = "session-1",
        checkpointSequence = 1,
    )

    private companion object {
        const val Server = "https://conduit.example"
        const val Account = "account@example.com"
        const val Profile = "00000000-0000-4000-8000-000000000001"
    }
}
