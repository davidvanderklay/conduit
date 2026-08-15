package media.conduit.mobile

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.foundation.MemorySecureStore

class PlaybackProgressOutboxTest {
    @Test
    fun failedCheckpointIsRetainedAndRetried() = runTest {
        var online = false
        val engine = MockEngine {
            if (!online) {
                respond("offline", HttpStatusCode.ServiceUnavailable)
            } else {
                respond(
                    """{"item":{"videoId":"video-1","mediaType":"movie","mediaId":"movie-1","name":"Movie","positionMs":10000,"durationMs":100000,"watched":false,"dismissed":false,"continueWatching":false,"updatedAt":"2026-08-14T12:00:00Z"}}""",
                    HttpStatusCode.OK,
                    headersOf("Content-Type", ContentType.Application.Json.toString()),
                )
            }
        }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val outbox = PlaybackProgressOutbox(api, MemorySecureStore())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile-1", "movie", "movie-1", "video-1"),
            url = "https://example.test/movie.mp4",
            title = "Movie",
            mediaName = "Movie",
        )

        val result = outbox.enqueue(
            baseUrl = "https://conduit.example",
            token = "token",
            accountId = "account-1",
            request = request,
            playback = PlaybackState(loading = false, positionMs = 10_000, durationMs = 100_000),
            identity = PlaybackCheckpointIdentity("session-1", 1),
            existing = null,
        )

        assertFalse(result.synced)
        assertEquals(10_000L, outbox.pendingSummaries("https://conduit.example", "account-1", "profile-1").single().positionMs)
        assertTrue(outbox.pendingSummaries("https://conduit.example", "account-2", "profile-1").isEmpty())
        assertEquals(10_000L, outbox.pendingSummaries("https://conduit.example", "account-1", "profile-1").single().positionMs)

        online = true
        val flushed = outbox.flush("https://conduit.example", "new-token", "account-1")

        assertEquals(1, flushed.size)
        assertTrue(outbox.pendingSummaries("https://conduit.example", "account-1", "profile-1").isEmpty())
    }

    @Test
    fun queuedWritesCoalesceToTheNewestCheckpoint() = runTest {
        val engine = MockEngine { respond("offline", HttpStatusCode.ServiceUnavailable) }
        val api = ConduitApi(HttpClient(engine) { install(ContentNegotiation) { json() } })
        val outbox = PlaybackProgressOutbox(api, MemorySecureStore())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile-1", "movie", "movie-1", "video-1"),
            url = "https://example.test/movie.mp4",
            title = "Movie",
            mediaName = "Movie",
        )

        outbox.enqueue(
            "https://conduit.example", "token", "account-1", request,
            PlaybackState(loading = false, positionMs = 10_000, durationMs = 100_000),
            PlaybackCheckpointIdentity("session-1", 1), null,
        )
        outbox.enqueue(
            "https://conduit.example", "token", "account-1", request,
            PlaybackState(loading = false, positionMs = 20_000, durationMs = 100_000),
            PlaybackCheckpointIdentity("session-1", 2), null,
        )

        assertEquals(20_000L, outbox.pendingSummaries("https://conduit.example", "account-1", "profile-1").single().positionMs)
    }
}
