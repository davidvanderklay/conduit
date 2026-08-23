package media.conduit.mobile

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SkipSegmentsTest {
    @Test
    fun activeSegmentMatchesWhileInsideTheWindowOnly() {
        val segments = listOf(SkipSegment(10_000, 90_000, SkipSegmentType.Intro))

        assertEquals(null, activeSkipSegment(9_999, segments))
        assertEquals(segments.first(), activeSkipSegment(10_000, segments))
        assertEquals(null, activeSkipSegment(90_000, segments))
    }

    @Test
    fun bannerUsesTheLastThirtySecondsWithoutSegmentData() {
        assertFalse(shouldShowUpNextBanner(0, 0, emptyList()))
        assertFalse(shouldShowUpNextBanner(29 * 60_000L, 30 * 60_000L + 1, emptyList()))
        assertTrue(shouldShowUpNextBanner(29 * 60_000L + 30_001, 30 * 60_000L + 1, emptyList()))
        assertFalse(shouldShowUpNextBanner(31 * 60_000L, 30 * 60_000L, emptyList()))
    }

    @Test
    fun bannerFiresAtOutroStartWhenCreditsRunToTheEnd() {
        // A 45-minute episode whose credits start at 42:00 and run to the end.
        val duration = 45 * 60_000L
        val segments = listOf(
            SkipSegment(20_000, 90_000, SkipSegmentType.Intro),
            SkipSegment(42 * 60_000L, duration - 10_000, SkipSegmentType.Outro),
        )

        assertFalse(shouldShowUpNextBanner(41 * 60_000L, duration, segments))
        assertTrue(shouldShowUpNextBanner(42 * 60_000L, duration, segments))
    }

    @Test
    fun bannerKeepsTheNormalWindowWhenOutroEndsWellBeforeTheEnd() {
        val duration = 45 * 60_000L
        val segments = listOf(
            SkipSegment(40 * 60_000L, 41 * 60_000L, SkipSegmentType.Outro),
        )

        // Post-outro gap of four minutes exceeds the 30s window, so only the
        // normal last-30-seconds rule shows the banner.
        assertFalse(shouldShowUpNextBanner(41 * 60_000L + 5_000, duration, segments))
        assertTrue(shouldShowUpNextBanner(duration - UP_NEXT_BANNER_WINDOW_MS, duration, segments))
    }

    @Test
    fun parsesIntroDbSecondsAndMilliseconds() {
        val body = """
            {
              "imdb_id": "tt0898266",
              "season": 1,
              "episode": 2,
              "intro": {"start_sec": 12.4, "end_sec": 102.8},
              "recap": {"start_ms": 1000, "end_ms": 15000},
              "outro": {"start_sec": 1580, "end_ms": 1595000}
            }
        """.trimIndent()

        val segments = parseIntroDbSegments(body)

        assertEquals(3, segments.size)
        assertEquals(SkipSegment(12_400, 102_800, SkipSegmentType.Intro), segments[0])
        assertEquals(SkipSegment(1_000, 15_000, SkipSegmentType.Recap), segments[1])
        assertEquals(SkipSegment(1_580_000, 1_595_000, SkipSegmentType.Outro), segments[2])
    }

    @Test
    fun parsingIgnoresMalformedOrMissingSegments() {
        assertTrue(parseIntroDbSegments("not json").isEmpty())
        assertTrue(
            parseIntroDbSegments("""{"intro": {"start_sec": 30}}""").isEmpty(),
        )
    }

    @Test
    fun repositoryFetchesOncePerEpisodeAndSkipsNonImdbIds() = runTest {
        var requests = 0
        val repository = SkipSegmentsRepository(
            HttpClient(MockEngine { request ->
                requests += 1
                assertTrue(request.url.toString().startsWith("https://api.introdb.app/segments?"))
                respond(
                    content = """{"intro": {"start_sec": 1, "end_sec": 60}}""",
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            }),
        )

        val first = repository.forEpisode("tt0898266", 1, 2)
        val second = repository.forEpisode("tt0898266", 1, 2)

        assertEquals(listOf(SkipSegment(1_000, 60_000, SkipSegmentType.Intro)), first)
        assertEquals(first, second)
        assertEquals(1, requests)

        assertTrue(repository.forEpisode("kitsu:12345", 1, 1).isEmpty())
        assertEquals(1, requests)
        assertTrue(repository.forEpisode("tt0898266", null, null).isEmpty())
        assertEquals(1, requests)
    }
}
