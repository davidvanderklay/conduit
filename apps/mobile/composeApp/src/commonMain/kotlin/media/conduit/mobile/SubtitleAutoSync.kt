package media.conduit.mobile

import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlin.coroutines.cancellation.CancellationException
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import media.conduit.mobile.account.createPlatformHttpClient

/** What subtitle auto sync found, shown under the subtitle delay control. */
sealed interface SubtitleAutoSyncResult {
    data class Synced(val delayMs: Long) : SubtitleAutoSyncResult
    data class Failed(val reason: String) : SubtitleAutoSyncResult
}

private const val MaxReads = 16
private const val ReadFailure = "Could not read this video's subtitle timing."
private val autoSyncClient by lazy { createPlatformHttpClient() }

/**
 * Finds the subtitle delay that lines the add-on subtitle at [subtitleUrl] up
 * with the subtitle timing embedded in the video at [videoUrl]. The Rust core
 * asks for the byte ranges it needs and this reads them with HTTP range
 * requests. Mirrors the web players' `autoSyncSubtitle`.
 */
@OptIn(ExperimentalEncodingApi::class)
suspend fun autoSyncSubtitle(
    videoUrl: String?,
    requestHeaders: Map<String, String>,
    subtitleUrl: String?,
): SubtitleAutoSyncResult {
    if (subtitleUrl.isNullOrBlank()) return SubtitleAutoSyncResult.Failed("Choose an add-on subtitle to sync.")
    if (videoUrl == null) return SubtitleAutoSyncResult.Failed(ReadFailure)
    return try {
        val subtitleText = autoSyncClient.get(subtitleUrl).bodyAsText()
        val ranges = mutableListOf<JsonObject>()
        var size: Long? = null
        repeat(MaxReads) {
            val step = coreValue(buildJsonObject {
                put("type", "subtitleTimeline")
                put("ranges", JsonArray(ranges))
                size?.let { put("size", it) }
            }).jsonObject
            if (step["kind"]?.jsonPrimitive?.content == "timeline") {
                val alignment = coreValue(buildJsonObject {
                    put("type", "alignSubtitle")
                    put("reference", step.getValue("starts"))
                    put("subtitle", subtitleText)
                }) as? JsonObject
                val delayMs = alignment?.get("delayMs")?.jsonPrimitive?.long
                    ?: return SubtitleAutoSyncResult.Failed("These subtitles do not match the embedded ones.")
                return SubtitleAutoSyncResult.Synced(stepSubtitleDelay(delayMs, 0))
            }
            val offset = step.getValue("offset").jsonPrimitive.long
            val length = step.getValue("length").jsonPrimitive.long
            // Streaming the response means a server that ignores Range is dropped, not downloaded.
            val bytes = autoSyncClient.prepareGet(videoUrl) {
                requestHeaders.forEach { (name, value) -> header(name, value) }
                header(HttpHeaders.Range, "bytes=$offset-${offset + length - 1}")
            }.execute { response ->
                if (response.status != HttpStatusCode.PartialContent) return@execute null
                size = size ?: response.headers[HttpHeaders.ContentRange]?.substringAfter('/')?.toLongOrNull()
                response.bodyAsBytes()
            } ?: return SubtitleAutoSyncResult.Failed(ReadFailure)
            ranges += buildJsonObject {
                put("offset", offset)
                put("data", Base64.encode(bytes))
            }
        }
        SubtitleAutoSyncResult.Failed(ReadFailure)
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        SubtitleAutoSyncResult.Failed(
            when (error.message?.substringBefore(':')) {
                "unsupported_container" -> "Auto sync works with MKV and MP4 videos."
                "no_subtitle_timing" -> "This video has no embedded subtitles to sync against."
                else -> ReadFailure
            },
        )
    }
}
