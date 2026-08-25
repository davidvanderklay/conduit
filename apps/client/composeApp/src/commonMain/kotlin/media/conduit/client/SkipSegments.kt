package media.conduit.client

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import media.conduit.client.account.createPlatformHttpClient

enum class SkipSegmentType { Intro, Outro, Recap }

data class SkipSegment(
    val startMs: Long,
    val endMs: Long,
    val type: SkipSegmentType,
)

/** How long before the end of an episode the up-next banner normally appears. */
const val UP_NEXT_BANNER_WINDOW_MS = 30_000L

/** How long a skip button stays visible before player controls can reveal it again. */
const val SKIP_PROMPT_VISIBLE_MS = 10_000L

fun activeSkipSegment(positionMs: Long, segments: List<SkipSegment>): SkipSegment? =
    segments.firstOrNull { positionMs >= it.startMs && positionMs < it.endMs }

/**
 * Whether the up-next banner should be visible at this playback position.
 *
 * With outro data whose credits run right up to the file end, the banner fires
 * at the earliest outro start so playback can resolve and swap during credits.
 * Otherwise (or when the outro ends well before the end) it uses the normal
 * last-30-seconds window.
 */
fun shouldShowUpNextBanner(
    positionMs: Long,
    durationMs: Long,
    segments: List<SkipSegment>,
): Boolean {
    if (durationMs <= 0L) return false
    val inNormalWindow = durationMs - positionMs in 1..UP_NEXT_BANNER_WINDOW_MS
    val outros = segments.filter { it.type == SkipSegmentType.Outro }
    if (outros.isEmpty()) return inNormalWindow
    val postOutroGapMs = durationMs - outros.maxOf(SkipSegment::endMs)
    return if (postOutroGapMs > UP_NEXT_BANNER_WINDOW_MS) {
        inNormalWindow
    } else {
        positionMs >= outros.minOf(SkipSegment::startMs)
    }
}

fun skipSegmentLabel(type: SkipSegmentType): String = when (type) {
    SkipSegmentType.Intro -> "Skip intro"
    SkipSegmentType.Outro -> "Skip outro"
    SkipSegmentType.Recap -> "Skip recap"
}

@Serializable
private data class IntroDbSegmentsResponse(
    val intro: IntroDbSegment? = null,
    val recap: IntroDbSegment? = null,
    val outro: IntroDbSegment? = null,
)

@Serializable
private data class IntroDbSegment(
    val start_sec: Double? = null,
    val end_sec: Double? = null,
    val start_ms: Long? = null,
    val end_ms: Long? = null,
)

private val introDbJson = Json { ignoreUnknownKeys = true; isLenient = true }

internal fun parseIntroDbSegments(body: String): List<SkipSegment> {
    val response = runCatching { introDbJson.decodeFromString<IntroDbSegmentsResponse>(body) }
        .getOrNull()
        ?: return emptyList()
    return listOfNotNull(
        response.intro.toSkipSegment(SkipSegmentType.Intro),
        response.recap.toSkipSegment(SkipSegmentType.Recap),
        response.outro.toSkipSegment(SkipSegmentType.Outro),
    )
}

private fun IntroDbSegment?.toSkipSegment(type: SkipSegmentType): SkipSegment? {
    if (this == null) return null
    val startMs = start_ms ?: start_sec?.times(1000)?.toLong() ?: return null
    val endMs = end_ms ?: end_sec?.times(1000)?.toLong() ?: return null
    if (endMs <= startMs) return null
    return SkipSegment(startMs, endMs, type)
}

internal fun imdbIdFromMediaId(mediaId: String): String? =
    mediaId.substringBefore(':').takeIf { it.startsWith("tt") }

/** Fetches community-sourced intro/outro/recap timestamps from IntroDB. */
class SkipSegmentsRepository(private val client: HttpClient = createPlatformHttpClient()) {
    private val cache = mutableMapOf<String, List<SkipSegment>>()

    suspend fun forEpisode(mediaId: String, season: Int?, episode: Int?): List<SkipSegment> {
        val imdbId = imdbIdFromMediaId(mediaId) ?: return emptyList()
        if (season == null || episode == null || season < 1 || episode < 1) return emptyList()
        val key = "$imdbId:$season:$episode"
        cache[key]?.let { return it }
        val segments = fetch(imdbId, season, episode)
        cache[key] = segments
        return segments
    }

    private suspend fun fetch(imdbId: String, season: Int, episode: Int): List<SkipSegment> =
        runCatching {
            val response = client.get("$INTRODB_BASE_URL/segments?imdb_id=$imdbId&season=$season&episode=$episode")
            if (!response.status.isSuccess()) return emptyList()
            parseIntroDbSegments(response.bodyAsText())
        }.getOrDefault(emptyList())

    private companion object {
        const val INTRODB_BASE_URL = "https://api.introdb.app"
    }
}
