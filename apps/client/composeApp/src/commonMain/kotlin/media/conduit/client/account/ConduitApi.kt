package media.conduit.client.account

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.patch
import io.ktor.client.request.put
import io.ktor.client.request.delete
import io.ktor.client.request.setBody
import io.ktor.client.plugins.timeout
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.encodeToJsonElement
import io.ktor.http.encodeURLPathPart
import kotlinx.coroutines.async
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.channels.Channel
import kotlin.time.TimeSource

@Serializable
data class ServerHealth(val status: String)

@Serializable
data class OidcConfiguration(
    val enabled: Boolean,
    val provider: String? = null,
    val displayName: String? = null,
)

@Serializable
data class AuthenticationConfiguration(
    val needsOwner: Boolean,
    val localRegistration: Boolean,
    val oidc: OidcConfiguration,
)

@Serializable
data class ProfileSummary(
    val id: String,
    val name: String,
    val isKids: Boolean,
    val usesPrimaryAddons: Boolean = false,
    val avatarColor: String? = null,
    val avatarUrl: String? = null,
)

@Serializable
private data class ProfileResponse(val profile: ProfileSummary)

@Serializable
data class HouseholdSummary(
    val id: String,
    val name: String,
    val role: String,
    val profiles: List<ProfileSummary>,
)

@Serializable
data class AccountUser(val email: String)

@Serializable
data class BootstrapResponse(val households: List<HouseholdSummary>, val user: AccountUser? = null)

@Serializable
data class AuthenticationMethods(
    val passwordEnabled: Boolean,
    val linkedProviders: List<String> = emptyList(),
    val configuredProvider: String? = null,
    val configuredProviderName: String? = null,
)

@Serializable
data class PasswordModeResponse(val passwordEnabled: Boolean)

@Serializable
data class InstalledAddonSummary(
    val id: String,
    val manifestId: String,
    val manifestUrl: String,
    val manifest: JsonObject,
    val position: Int,
    val enabled: Boolean,
)

@Serializable
data class AddonsResponse(val addons: List<InstalledAddonSummary>)

@Serializable
data class LibraryItemSummary(
    val id: String,
    val type: String,
    val name: String,
    val poster: String? = null,
    val background: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
    val runtime: String? = null,
    val updatedAt: String,
)

@Serializable
data class LibraryResponse(val items: List<LibraryItemSummary>)
@Serializable private data class LibraryItemResponse(val item: LibraryItemSummary)

@Serializable
data class ProgressSummary(
    val videoId: String,
    val mediaType: String,
    val mediaId: String,
    val name: String,
    val poster: String? = null,
    val videoTitle: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val positionMs: Long,
    val durationMs: Long,
    val watched: Boolean,
    val dismissed: Boolean = false,
    val continueWatching: Boolean = false,
    val playbackSource: PlaybackSource? = null,
    val updatedAt: String,
    val canonicalTitleId: String? = null,
    val canonicalEpisodeKey: String? = null,
    val revision: Long = 0,
)

private val progressRecencyComparator = compareBy<ProgressSummary> { it.updatedAt }
    .thenBy { it.revision }
    .thenBy { it.videoId }

/** Orders progress rows the same way history and Continue Watching present recent activity. */
internal fun progressByRecency(items: Iterable<ProgressSummary>): List<ProgressSummary> =
    items.sortedWith(progressRecencyComparator.reversed())

/** Keeps the newest progress row for each canonical title and orders titles by recent activity. */
internal fun latestProgressByTitle(items: Iterable<ProgressSummary>): List<ProgressSummary> = items
    .groupBy { item -> item.canonicalTitleId ?: "${item.mediaType}\u001f${item.mediaId}" }
    .values
    .mapNotNull { entries -> entries.maxWithOrNull(progressRecencyComparator) }
    .let(::progressByRecency)

@Serializable
data class ProgressResponse(val items: List<ProgressSummary>)
@Serializable private data class ProgressItemResponse(val item: ProgressSummary? = null)

@Serializable
data class ProgressIdentity(
    val mediaType: String,
    val mediaId: String,
    val canonicalTitleId: String? = null,
    val aliases: List<String> = emptyList(),
    val videoId: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
)

@Serializable
sealed interface ProgressOperation {
    val identity: ProgressIdentity

    @Serializable
    @kotlinx.serialization.SerialName("upsert")
    data class Upsert(
        override val identity: ProgressIdentity,
        val name: String,
        val poster: String? = null,
        val videoTitle: String? = null,
        val positionMs: Long,
        val durationMs: Long,
        val watched: Boolean,
        val playbackSource: PlaybackSource? = null,
        val checkpointSessionId: String,
        val checkpointSequence: Long,
    ) : ProgressOperation

    @Serializable
    @kotlinx.serialization.SerialName("dismissTitle")
    data class DismissTitle(override val identity: ProgressIdentity) : ProgressOperation

    @Serializable
    @kotlinx.serialization.SerialName("restoreTitle")
    data class RestoreTitle(override val identity: ProgressIdentity) : ProgressOperation

    @Serializable
    @kotlinx.serialization.SerialName("deleteEpisode")
    data class DeleteEpisode(override val identity: ProgressIdentity) : ProgressOperation

    @Serializable
    @kotlinx.serialization.SerialName("deleteTitle")
    data class DeleteTitle(override val identity: ProgressIdentity) : ProgressOperation
}

@Serializable data class ProgressOperationRequest(val operationId: String, val operation: ProgressOperation)
@Serializable data class ProgressEvent(val revision: Long, val type: String, val payload: JsonObject)
@Serializable data class ProgressOperationResult(
    val accepted: Boolean,
    val reason: String? = null,
    val generation: Long,
    val revision: Long,
    val event: ProgressEvent? = null,
)
@Serializable data class ProgressSnapshotPage(
    val generation: Long,
    val boundary: Long,
    val items: List<ProgressSummary>,
    val nextAfterVideoId: String? = null,
)
@Serializable data class ProgressChangesPage(
    val generation: Long,
    val events: List<ProgressEvent>,
    val nextCursor: Long,
    val hasMore: Boolean,
)

@Serializable
data class ProfileSnapshot(
    val profileId: String,
    val addons: List<InstalledAddonSummary>,
    val library: List<LibraryItemSummary>,
    val progress: List<ProgressSummary>,
    val history: List<ProgressSummary> = emptyList(),
    val continueWatching: List<ProgressSummary> = emptyList(),
    val queue: List<PlaybackQueueItem> = emptyList(),
)

@Serializable
data class PlaybackQueueItem(
    val mediaType: String,
    val mediaId: String,
    val videoId: String,
    val name: String,
    val poster: String? = null,
    val artwork: String? = null,
    val videoTitle: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
) {
    val key: String get() = "$mediaType\u0000$mediaId\u0000$videoId"
}

@Serializable
private data class PlaybackQueueResponse(val items: List<PlaybackQueueItem>)

@Serializable
data class CatalogItem(
    val id: String,
    val type: String,
    val name: String,
    val poster: String? = null,
    val background: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
)

@Serializable
data class VideoItem(
    val id: String,
    val title: String? = null,
    val name: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val released: String? = null,
    val available: Boolean? = null,
    val thumbnail: String? = null,
    val overview: String? = null,
    val description: String? = null,
)

@Serializable
data class TrailerItem(val source: String? = null, val type: String? = null)

@Serializable
data class TrailerStreamItem(val title: String? = null, val youtubeId: String? = null)

@Serializable
data class MetaItem(
    val id: String,
    val type: String,
    val name: String,
    val poster: String? = null,
    val background: String? = null,
    val logo: String? = null,
    val defaultVideoId: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
    val runtime: String? = null,
    val genres: List<String> = emptyList(),
    val imdbRating: String? = null,
    val contentRating: String? = null,
    val director: List<String> = emptyList(),
    val cast: List<String> = emptyList(),
    val writer: List<String> = emptyList(),
    val country: String? = null,
    val awards: String? = null,
    val released: String? = null,
    val trailers: List<TrailerItem> = emptyList(),
    val trailerStreams: List<TrailerStreamItem> = emptyList(),
    val videos: List<VideoItem> = emptyList(),
    @kotlinx.serialization.SerialName("imdb_id") val imdbId: String? = null,
    val externalIds: JsonObject = JsonObject(emptyMap()),
)

fun MetaItem.progressAliases(): List<String> = buildList {
    add(id)
    imdbId?.let(::add)
    externalIds.forEach { (provider, value) ->
        value.jsonPrimitive.contentOrNull?.let { id ->
            add(if (id.contains(':')) id else "$provider:$id")
            if (provider.equals("imdb", ignoreCase = true)) add(id)
        }
    }
}.distinct()

@Serializable
data class StreamProxyHeaders(val request: Map<String, JsonElement> = emptyMap())
@Serializable
data class StreamBehaviorHints(
    val proxyHeaders: StreamProxyHeaders? = null,
    val filename: String? = null,
    val bingeGroup: String? = null,
)

@Serializable
data class PlaybackSource(
    val addonId: String,
    val sourceKey: String,
    val kind: String,
    val infoHash: String? = null,
    val fileIdx: String? = null,
    val name: String? = null,
    val title: String? = null,
    val filename: String? = null,
    val bingeGroup: String? = null,
)

@Serializable
data class StreamItem(
    val url: String? = null,
    val externalUrl: String? = null,
    val infoHash: String? = null,
    val fileIdx: JsonElement? = null,
    val name: String? = null,
    val title: String? = null,
    val description: String? = null,
    val behaviorHints: StreamBehaviorHints? = null,
)

data class StreamSource(val addonId: String, val addonName: String, val stream: StreamItem)

fun playbackSourceForStream(addonId: String, stream: StreamItem): PlaybackSource = PlaybackSource(
    addonId = addonId,
    sourceKey = streamSourceKey(stream),
    kind = when {
        stream.infoHash != null -> "torrent"
        stream.url != null -> "url"
        else -> "other"
    },
    infoHash = stream.infoHash,
    fileIdx = stream.fileIdx?.toString()?.trim('"'),
    name = stream.name,
    title = stream.title,
    filename = stream.behaviorHints?.filename,
    bingeGroup = stream.behaviorHints?.bingeGroup,
)

fun selectSavedStream(
    streams: List<StreamSource>,
    source: PlaybackSource?,
): StreamSource? {
    val saved = source ?: return null
    val candidates = streams.filter(::isAutoSelectableStream)
    val exactMatches = candidates.filter { candidate -> streamSourceKey(candidate.stream) == saved.sourceKey }
    val sameAddonExactMatches = exactMatches.filter { it.addonId == saved.addonId }
    if (sameAddonExactMatches.size == 1) return sameAddonExactMatches.first()
    if (sameAddonExactMatches.size > 1) return null
    if (exactMatches.size == 1) return exactMatches.first()
    val bingeGroup = saved.bingeGroup?.takeIf(String::isNotBlank) ?: return null
    val groupMatches = candidates.filter { candidate ->
        candidate.stream.behaviorHints?.bingeGroup == bingeGroup
    }
    val sameAddonGroupMatches = groupMatches.filter { it.addonId == saved.addonId }
    if (sameAddonGroupMatches.size == 1) return sameAddonGroupMatches.first()
    if (sameAddonGroupMatches.size > 1) return null
    return groupMatches.singleOrNull()
}

fun selectSingleAutoStream(
    streams: List<StreamSource>,
    excludedStream: StreamSource? = null,
): StreamSource? {
    val excludedSourceKey = excludedStream?.stream?.let(::streamSourceKey)
    return streams
        .filter(::isAutoSelectableStream)
        .filter { excludedSourceKey == null || streamSourceKey(it.stream) != excludedSourceKey }
        .singleOrNull()
}

/** Ranks direct streams for an automatic transition without changing provider order on ties. */
fun rankAutomaticStreams(
    streams: List<StreamSource>,
    previousSource: PlaybackSource? = null,
    savedSource: PlaybackSource? = null,
): List<StreamSource> {
    val targetResolution = streamResolution(previousSource)
    val indexed = streams
        .filter(::isAutoSelectableStream)
        .mapIndexed { index, source -> IndexedValue(index, source) }

    return indexed.sortedWith(
        compareBy<IndexedValue<StreamSource>>(
            { candidate -> if (savedSource != null && streamSourceKey(candidate.value.stream) == savedSource.sourceKey) 0 else 1 },
            { candidate ->
                val bingeGroup = previousSource?.bingeGroup?.takeIf(String::isNotBlank)
                if (bingeGroup != null && candidate.value.stream.behaviorHints?.bingeGroup == bingeGroup) 0 else 1
            },
            { candidate -> if (previousSource != null && candidate.value.addonId == previousSource.addonId) 0 else 1 },
            { candidate -> resolutionRank(streamResolution(candidate.value.stream), targetResolution).first },
            { candidate -> resolutionRank(streamResolution(candidate.value.stream), targetResolution).second },
            IndexedValue<StreamSource>::index,
        ),
    ).map(IndexedValue<StreamSource>::value)
        .distinctBy { streamSourceKey(it.stream) }
}

private fun resolutionRank(candidate: Int?, target: Int?): Pair<Int, Int> = when {
    target == null -> 0 to 0
    candidate == null -> 3 to Int.MAX_VALUE
    candidate == target -> 0 to 0
    candidate < target -> 1 to target - candidate
    else -> 2 to candidate - target
}

private fun streamResolution(source: PlaybackSource?): Int? = source?.let {
    parseStreamResolution(listOf(it.name, it.title, it.filename, it.bingeGroup))
}

private fun streamResolution(stream: StreamItem): Int? = parseStreamResolution(
    listOf(
        stream.name,
        stream.title,
        stream.description,
        stream.behaviorHints?.filename,
        stream.behaviorHints?.bingeGroup,
    ),
)

private fun parseStreamResolution(values: List<String?>): Int? {
    val value = values.filterNotNull().joinToString(" ")
    if (Regex("(?i)(?:^|[^a-z0-9])(?:4k|uhd)(?:$|[^a-z0-9])").containsMatchIn(value)) return 2160
    return Regex("(?i)(?:^|[^0-9])(2160|1440|1080|720|576|480|360)p?(?:$|[^0-9])")
        .find(value)
        ?.groupValues
        ?.getOrNull(1)
        ?.toIntOrNull()
}

private fun isAutoSelectableStream(candidate: StreamSource): Boolean =
    isPlayableStreamUrl(candidate.stream.url)

private fun isPlayableStreamUrl(value: String?): Boolean {
    val protocol = value?.substringBefore(':')?.lowercase()
    return protocol == "http" || protocol == "https"
}

internal fun streamSourceKey(stream: StreamItem): String = when {
    stream.infoHash != null -> "torrent:${stream.infoHash.lowercase()}:${stream.fileIdx?.toString()?.trim('"').orEmpty()}"
    stream.url != null -> "url:${normalizeStreamUrl(stream.url)}"
    else -> "other:${normalizeSourceText(listOf(stream.name, stream.title, stream.behaviorHints?.filename))}"
}

private fun normalizeStreamUrl(value: String): String {
    val withoutFragment = value.substringBefore('#')
    val base = withoutFragment.substringBefore('?').trimEnd('/')
    val query = withoutFragment.substringAfter('?', "")
        .split('&')
        .mapNotNull { part ->
            val key = part.substringBefore('=', part).trim()
            if (key.isBlank() || Regex("token|sig|signature|expires|expiry|auth|key", RegexOption.IGNORE_CASE).containsMatchIn(key)) null
            else part
        }
        .sorted()
        .joinToString("&")
    return if (query.isBlank()) base else "$base?$query"
}

private fun normalizeSourceText(values: List<String?>): String =
    values.filterNotNull().joinToString("|").trim().lowercase().replace(Regex("\\s+"), " ")

@Serializable
data class SubtitleItem(val id: String? = null, val url: String, val lang: String? = null, val addonName: String? = null)

@Serializable
private data class SubtitlesResponse(val subtitles: List<SubtitleItem> = emptyList())

@Serializable
private data class MetaResponse(val meta: MetaItem? = null)

@Serializable
private data class StreamsResponse(val streams: List<StreamItem> = emptyList())

@Serializable
private data class CatalogResponse(val metas: List<CatalogItem> = emptyList())

private val addonJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

private val metadataStringListFields = setOf("genres", "director", "cast", "writer")
private val metadataArrayFields = metadataStringListFields + setOf("trailers", "trailerStreams", "videos")
private val metadataTextFields = setOf(
    "description",
    "releaseInfo",
    "runtime",
    "imdbRating",
    "contentRating",
    "country",
    "awards",
    "released",
    "poster",
    "background",
    "logo",
)

private suspend inline fun <reified T> HttpResponse.decodeAddonBody(
    normalize: (JsonElement) -> JsonElement = { it },
): T {
    val value = addonJson.parseToJsonElement(bodyAsText())
    return addonJson.decodeFromJsonElement(normalize(value))
}

private fun normalizeMetaResponse(value: JsonElement): JsonElement {
    val root = value as? JsonObject ?: return value
    val meta = root["meta"] as? JsonObject ?: return value
    val normalizedMeta = buildJsonObject {
        meta.forEach { (key, field) ->
            when {
                key in metadataStringListFields -> put(key, normalizeStringList(field))
                key in metadataArrayFields -> put(key, field as? JsonArray ?: JsonArray(emptyList()))
                key in metadataTextFields -> put(key, normalizeTextField(field))
                else -> put(key, field)
            }
        }
    }
    return buildJsonObject {
        root.forEach { (key, field) -> put(key, if (key == "meta") normalizedMeta else field) }
    }
}

private fun normalizeStringList(value: JsonElement): JsonArray = when (value) {
    is JsonArray -> JsonArray(
        value.mapNotNull { item ->
            (item as? JsonPrimitive)
                ?.takeIf(JsonPrimitive::isString)
                ?.contentOrNull
                ?.trim()
                ?.takeIf(String::isNotBlank)
        }.distinct().map(::JsonPrimitive),
    )
    is JsonPrimitive -> value.contentOrNull
        ?.trim()
        ?.takeIf(String::isNotBlank)
        ?.let(::JsonPrimitive)
        ?.let(::listOf)
        ?.let(::JsonArray)
        ?: JsonArray(emptyList())
    else -> JsonArray(emptyList())
}

private fun normalizeTextField(value: JsonElement): JsonElement =
    (value as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        ?.takeIf(String::isNotBlank)
        ?.let(::JsonPrimitive)
        ?: JsonNull

data class HomeCatalog(
    val key: String,
    val title: String,
    val items: List<CatalogItem>,
    val addonId: String,
    val type: String,
    val catalogId: String,
)

data class HomeCatalogResult(
    val catalogs: List<HomeCatalog>,
    val failedRequests: Int,
)

data class DiscoverCatalog(
    val addonId: String,
    val manifestUrl: String,
    val addonName: String,
    val type: String,
    val id: String,
    val name: String,
    val supportsGenre: Boolean,
    val genres: List<String>,
    val genreRequired: Boolean,
)

fun discoverCatalogs(addons: List<InstalledAddonSummary>): List<DiscoverCatalog> = addons
    .filter(InstalledAddonSummary::enabled)
    .flatMap { addon ->
        val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
        addon.manifest["catalogs"]?.jsonArray.orEmpty().mapNotNull { it as? JsonObject }.mapNotNull { catalog ->
            val extras = catalog["extra"]?.jsonArray.orEmpty().mapNotNull { it as? JsonObject }
            if (extras.any { extra ->
                    extra["isRequired"]?.jsonPrimitive?.booleanOrNull == true &&
                        extra["name"]?.jsonPrimitive?.contentOrNull != "genre"
                }
            ) return@mapNotNull null
            val id = catalog["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val type = catalog["type"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val genre = extras.firstOrNull { it["name"]?.jsonPrimitive?.contentOrNull == "genre" }
            DiscoverCatalog(
                addonId = addon.id,
                manifestUrl = addon.manifestUrl,
                addonName = addonName,
                type = type,
                id = id,
                name = catalog["name"]?.jsonPrimitive?.contentOrNull ?: id.replaceFirstChar(Char::uppercase),
                supportsGenre = genre != null,
                genres = genre?.get("options")?.jsonArray.orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull },
                genreRequired = genre?.get("isRequired")?.jsonPrimitive?.booleanOrNull == true,
            )
        }
    }

private data class SearchCatalogRequest(val addon: InstalledAddonSummary, val type: String, val id: String, val name: String)

internal fun InstalledAddonSummary.supportsResource(resource: String, type: String, id: String): Boolean {
    val resources = manifest["resources"]?.jsonArray ?: return false
    return resources.any { entry ->
        val primitiveName = runCatching { entry.jsonPrimitive.contentOrNull }.getOrNull()
        if (primitiveName != null) return@any primitiveName == resource
        val definition = runCatching { entry.jsonObject }.getOrNull() ?: return@any false
        if (definition["name"]?.jsonPrimitive?.contentOrNull != resource) return@any false
        val types = definition["types"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
        val prefixes = definition["idPrefixes"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
        (types.isEmpty() || type in types) && (prefixes.isEmpty() || prefixes.any(id::startsWith))
    }
}

@Serializable
data class RecoveryCodesResponse(val codes: List<String>)

@Serializable
data class MobileAuthStart(
    val requestId: String,
    val expiresAt: String,
    val authorizationUrl: String,
)

@Serializable
data class DesktopAuthStart(
    val requestId: String,
    val expiresAt: String,
)

@Serializable
data class MobileAuthExchange(val token: String, val expiresAt: String)

data class ValidatedServer(
    val authentication: AuthenticationConfiguration,
)

data class AuthenticatedSession(val token: String)

class ServerRequestException(message: String, val statusCode: Int? = null) : Exception(message)

class ConduitApi(private val client: HttpClient = createPlatformHttpClient()) {
    private val metadataCache = linkedMapOf<String, MetaItem>()
    suspend fun validate(baseUrl: String): ValidatedServer = try {
        validateServer(baseUrl)
    } catch (cause: ServerRequestException) {
        throw cause
    } catch (cause: Throwable) {
        if (cause is CancellationException) throw cause
        throw ServerRequestException(
            "Could not connect to this conduit server. Check that it is running and that the address is correct.",
        )
    }

    private suspend fun validateServer(baseUrl: String): ValidatedServer {
        val healthResponse = client.get("$baseUrl/health") {
            timeout {
                requestTimeoutMillis = 75_000
                socketTimeoutMillis = 75_000
            }
        }
        if (!healthResponse.status.isSuccess()) {
            throw ServerRequestException(
                "Health check returned HTTP ${healthResponse.status.value}",
                healthResponse.status.value,
            )
        }
        if (healthResponse.body<ServerHealth>().status != "ok") {
            throw ServerRequestException("The server returned an unexpected health response")
        }

        val configResponse = client.get("$baseUrl/v1/auth/config") {
            timeout {
                requestTimeoutMillis = 75_000
                socketTimeoutMillis = 75_000
            }
        }
        if (!configResponse.status.isSuccess()) {
            throw ServerRequestException(
                "Authentication discovery returned HTTP ${configResponse.status.value}",
                configResponse.status.value,
            )
        }
        return ValidatedServer(configResponse.body())
    }

    suspend fun bootstrap(baseUrl: String, token: String): BootstrapResponse {
        val response = client.get("$baseUrl/v1/bootstrap") { bearerAuth(token) }
        if (!response.status.isSuccess()) {
            throw ServerRequestException(
                if (response.status.value == 401) "Your session has expired" else
                    "Synchronization returned HTTP ${response.status.value}",
                response.status.value,
            )
        }
        return response.body()
    }

    suspend fun applyProgressOperation(
        baseUrl: String,
        token: String,
        profileId: String,
        operationId: String,
        operation: ProgressOperation,
    ): ProgressOperationResult {
        val response = client.post("$baseUrl/v1/profiles/$profileId/progress/operations") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(ProgressOperationRequest(operationId, operation))
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException(response.bodyAsText().ifBlank { "Progress operation returned HTTP ${response.status.value}" }, response.status.value)
        }
        return response.body()
    }

    suspend fun progressSnapshotPage(
        baseUrl: String,
        token: String,
        profileId: String,
        boundary: Long? = null,
        generation: Long? = null,
        afterVideoId: String? = null,
        limit: Int = 200,
    ): ProgressSnapshotPage {
        val parameters = buildList {
            add("limit=$limit")
            boundary?.let { add("boundary=$it") }
            generation?.let { add("generation=$it") }
            afterVideoId?.let { add("afterVideoId=${it.encodeURLPathPart()}") }
        }.joinToString("&")
        val response = client.get("$baseUrl/v1/profiles/$profileId/progress/snapshot?$parameters") { bearerAuth(token) }
        if (!response.status.isSuccess()) throw ServerRequestException(response.bodyAsText().ifBlank { "Progress snapshot returned HTTP ${response.status.value}" }, response.status.value)
        return response.body()
    }

    suspend fun progressChanges(
        baseUrl: String,
        token: String,
        profileId: String,
        generation: Long,
        after: Long,
        limit: Int = 200,
    ): ProgressChangesPage {
        val response = client.get("$baseUrl/v1/profiles/$profileId/progress/changes?generation=$generation&after=$after&limit=$limit") { bearerAuth(token) }
        if (!response.status.isSuccess()) throw ServerRequestException(response.bodyAsText().ifBlank { "Progress changes returned HTTP ${response.status.value}" }, response.status.value)
        return response.body()
    }

    suspend fun signIn(baseUrl: String, email: String, password: String): AuthenticatedSession {
        return authenticate(
            "$baseUrl/api/auth/sign-in/email",
            buildJsonObject { put("email", email.trim()); put("password", password) },
        )
    }

    suspend fun register(baseUrl: String, email: String, password: String): AuthenticatedSession {
        return authenticate(
            "$baseUrl/api/auth/sign-up/email",
            buildJsonObject {
                put("email", email.trim())
                put("password", password)
                put("name", "conduit account")
            },
        )
    }

    suspend fun recoverAccount(baseUrl: String, email: String, code: String, password: String) {
        val response = client.post("$baseUrl/v1/auth/recover") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("email", email.trim()); put("code", code.trim()); put("password", password) })
        }
        if (!response.status.isSuccess()) throw ServerRequestException(response.bodyAsText().ifBlank { "Recovery failed" }, response.status.value)
    }

    private suspend fun authenticate(url: String, credentials: JsonElement): AuthenticatedSession {
        val response = client.post(url) {
            contentType(ContentType.Application.Json)
            setBody(credentials)
        }
        if (!response.status.isSuccess()) {
            val serverMessage = runCatching {
                Json.parseToJsonElement(response.bodyAsText())
                    .jsonObject["message"]?.jsonPrimitive?.contentOrNull
            }.getOrNull()
            throw ServerRequestException(
                if (response.status.value == 401) "Incorrect email or password" else
                    serverMessage ?: "Authentication returned HTTP ${response.status.value}",
                response.status.value,
            )
        }
        val token = response.headers["set-auth-token"]
            ?: throw ServerRequestException("The server did not return a mobile session")
        return AuthenticatedSession(token)
    }

    suspend fun signOut(baseUrl: String, token: String) {
        client.post("$baseUrl/api/auth/sign-out") { bearerAuth(token) }
    }

    suspend fun createHousehold(
        baseUrl: String,
        token: String,
        householdName: String,
        profileName: String,
    ) {
        val response = client.post("$baseUrl/v1/households") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("name", householdName.trim())
                    put("profileName", profileName.trim())
                },
            )
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException(
                "Household creation returned HTTP ${response.status.value}",
                response.status.value,
            )
        }
    }

    suspend fun createProfile(
        baseUrl: String, token: String, householdId: String, name: String,
        isKids: Boolean, usesPrimaryAddons: Boolean, avatarColor: String?, avatarUrl: String?,
    ): ProfileSummary {
        val response = client.post("$baseUrl/v1/households/$householdId/profiles") {
            bearerAuth(token); contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", name.trim()); put("isKids", isKids); put("usesPrimaryAddons", usesPrimaryAddons); avatarColor?.let { put("avatarColor", it) }
                avatarUrl?.let { put("avatarUrl", it) }
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Profile creation returned HTTP ${response.status.value}", response.status.value)
        return response.body<ProfileResponse>().profile
    }

    suspend fun updateProfile(
        baseUrl: String, token: String, profileId: String, name: String,
        isKids: Boolean, usesPrimaryAddons: Boolean, avatarColor: String?, avatarUrl: String?,
    ): ProfileSummary {
        val response = client.patch("$baseUrl/v1/profiles/$profileId") {
            bearerAuth(token); contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", name.trim()); put("isKids", isKids); put("usesPrimaryAddons", usesPrimaryAddons); if (avatarColor == null) put("avatarColor", kotlinx.serialization.json.JsonNull) else put("avatarColor", avatarColor)
                if (avatarUrl == null) put("avatarUrl", kotlinx.serialization.json.JsonNull) else put("avatarUrl", avatarUrl)
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Profile update returned HTTP ${response.status.value}", response.status.value)
        return response.body<ProfileResponse>().profile
    }

    suspend fun installAddon(baseUrl: String, token: String, profileId: String, rawUrl: String) {
        val manifestUrl = rawUrl.trim().let { if (it.startsWith("stremio://")) "https://${it.removePrefix("stremio://")}" else it }
        val manifestResponse = client.get(manifestUrl)
        if (!manifestResponse.status.isSuccess()) throw ServerRequestException("Manifest returned HTTP ${manifestResponse.status.value}")
        val manifest = manifestResponse.body<JsonObject>()
        val response = client.post("$baseUrl/v1/profiles/$profileId/addons") {
            bearerAuth(token); contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("manifestUrl", manifestUrl); put("manifest", manifest) })
        }
        if (!response.status.isSuccess()) throw ServerRequestException(response.bodyAsText().ifBlank { "Add-on installation returned HTTP ${response.status.value}" }, response.status.value)
    }

    suspend fun setAddonEnabled(baseUrl: String, token: String, profileId: String, addonId: String, enabled: Boolean) {
        val response = client.patch("$baseUrl/v1/profiles/$profileId/addons/$addonId") {
            bearerAuth(token); contentType(ContentType.Application.Json); setBody(buildJsonObject { put("enabled", enabled) })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to update add-on", response.status.value)
    }

    suspend fun moveAddon(baseUrl: String, token: String, profileId: String, addonId: String, position: Int) {
        val response = client.patch("$baseUrl/v1/profiles/$profileId/addons/$addonId") {
            bearerAuth(token); contentType(ContentType.Application.Json); setBody(buildJsonObject { put("position", position) })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to reorder add-on", response.status.value)
    }

    suspend fun removeAddon(baseUrl: String, token: String, profileId: String, addonId: String) {
        val response = client.delete("$baseUrl/v1/profiles/$profileId/addons/$addonId") { bearerAuth(token) }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to remove add-on", response.status.value)
    }

    suspend fun synchronizeProfile(
        baseUrl: String,
        token: String,
        profileId: String,
        progressOverride: List<ProgressSummary>? = null,
    ): ProfileSnapshot =
        coroutineScope {
            suspend fun get(path: String) = client.get("$baseUrl$path") { bearerAuth(token) }
            val addons = async { get("/v1/profiles/$profileId/addons") }
            val library = async { get("/v1/profiles/$profileId/library") }
            val progress = if (progressOverride == null) {
                async { get("/v1/profiles/$profileId/progress?view=status&limit=1000") }
            } else {
                null
            }
            val history = if (progressOverride == null) {
                async { get("/v1/profiles/$profileId/progress?view=history&limit=1000") }
            } else {
                null
            }
            val continueWatching = if (progressOverride == null) {
                async { get("/v1/profiles/$profileId/progress?view=continue&limit=50") }
            } else {
                null
            }
            val queue = async { get("/v1/profiles/$profileId/queue") }
            val queueResponse = queue.await()
            val progressResponses = listOfNotNull(progress?.await(), history?.await(), continueWatching?.await())
            val responses = listOf(addons.await(), library.await()) + progressResponses
            responses.firstOrNull { !it.status.isSuccess() }?.let { response ->
                throw ServerRequestException(
                    if (response.status.value == 401) "Your session has expired" else
                        "Profile synchronization returned HTTP ${response.status.value}",
                    response.status.value,
                )
            }
            ProfileSnapshot(
                profileId = profileId,
                addons = responses[0].body<AddonsResponse>().addons,
                library = responses[1].body<LibraryResponse>().items,
                progress = progressOverride ?: responses[2].body<ProgressResponse>().items,
                history = progressOverride ?: responses[3].body<ProgressResponse>().items,
                continueWatching = latestProgressByTitle(
                    (progressOverride ?: responses[4].body<ProgressResponse>().items)
                        .filter { it.continueWatching && !it.dismissed },
                ),
                queue = if (queueResponse.status.value == 404) emptyList() else {
                    if (!queueResponse.status.isSuccess()) {
                        throw ServerRequestException("Profile synchronization returned HTTP ${queueResponse.status.value}", queueResponse.status.value)
                    }
                    queueResponse.body<PlaybackQueueResponse>().items
                },
            )
        }

    suspend fun replaceQueue(
        baseUrl: String,
        token: String,
        profileId: String,
        items: List<PlaybackQueueItem>,
    ) {
        val response = client.put("$baseUrl/v1/profiles/$profileId/queue") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("items", Json.encodeToJsonElement(items)) })
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException("Unable to update queue", response.status.value)
        }
    }

    suspend fun saveLibraryItem(
        baseUrl: String,
        token: String,
        profileId: String,
        item: CatalogItem,
        runtime: String? = null,
    ): LibraryItemSummary {
        val response = client.put(
            "$baseUrl/v1/profiles/$profileId/library/${item.type.encodeURLPathPart()}/${item.id.encodeURLPathPart()}",
        ) {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", item.name)
                item.poster?.let { put("poster", it) }
                item.background?.let { put("background", it) }
                item.description?.let { put("description", it) }
                item.releaseInfo?.let { put("releaseInfo", it) }
                runtime?.let { put("runtime", it) }
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to save library item", response.status.value)
        return response.body<LibraryItemResponse>().item
    }

    suspend fun removeLibraryItem(
        baseUrl: String,
        token: String,
        profileId: String,
        mediaType: String,
        mediaId: String,
    ) {
        val response = client.delete(
            "$baseUrl/v1/profiles/$profileId/library/${mediaType.encodeURLPathPart()}/${mediaId.encodeURLPathPart()}",
        ) { bearerAuth(token) }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to remove library item", response.status.value)
    }

    suspend fun setProgressWatched(
        baseUrl: String,
        token: String,
        profileId: String,
        progress: ProgressSummary?,
        item: CatalogItem,
        video: VideoItem?,
        watched: Boolean,
    ): ProgressSummary {
        val videoId = progress?.videoId ?: video?.id ?: item.id
        val url = "$baseUrl/v1/profiles/$profileId/progress/${videoId.encodeURLPathPart()}"
        val response = if (progress != null) {
            client.patch(url) {
                bearerAuth(token)
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("watched", watched) })
            }
        } else {
            client.put(url) {
                bearerAuth(token)
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject {
                    put("mediaType", item.type)
                    put("mediaId", item.id)
                    put("name", item.name)
                    item.poster?.let { put("poster", it) }
                    video?.title?.let { put("videoTitle", it) }
                    video?.season?.let { put("season", it) }
                    video?.episode?.let { put("episode", it) }
                    put("positionMs", 0)
                    put("durationMs", 0)
                    put("watched", watched)
                })
            }
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to update watch state", response.status.value)
        return response.body<ProgressItemResponse>().item
            ?: throw ServerRequestException("The server did not return watch state")
    }

    suspend fun setProgressDismissed(
        baseUrl: String,
        token: String,
        profileId: String,
        videoId: String,
        dismissed: Boolean,
    ) {
        val response = client.patch("$baseUrl/v1/profiles/$profileId/progress/${videoId.encodeURLPathPart()}") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("dismissed", dismissed) })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to update Continue Watching", response.status.value)
    }

    suspend fun deleteProgress(baseUrl: String, token: String, profileId: String, videoId: String) {
        val response = client.delete("$baseUrl/v1/profiles/$profileId/progress/${videoId.encodeURLPathPart()}") {
            bearerAuth(token)
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to remove watch history", response.status.value)
    }

    suspend fun loadProgress(baseUrl: String, token: String, profileId: String, videoId: String): ProgressSummary? {
        val response = client.get("$baseUrl/v1/profiles/$profileId/progress/${videoId.encodeURLPathPart()}") { bearerAuth(token) }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to load playback progress", response.status.value)
        return response.body<ProgressItemResponse>().item
    }

    suspend fun saveProgress(
        baseUrl: String, token: String, profileId: String, videoId: String,
        mediaType: String, mediaId: String, name: String, poster: String?,
        videoTitle: String?, season: Int?, episode: Int?, positionMs: Long, durationMs: Long,
        playbackSource: PlaybackSource? = null,
        clearPlaybackSource: Boolean = false,
        watched: Boolean? = null,
        checkpointSessionId: String? = null,
        checkpointSequence: Long? = null,
        checkpointUpdatedAt: String? = null,
    ): ProgressSummary? {
        if (durationMs < 0) return null
        val response = client.put("$baseUrl/v1/profiles/$profileId/progress/${videoId.encodeURLPathPart()}") {
            bearerAuth(token); contentType(ContentType.Application.Json); setBody(buildJsonObject {
                put("mediaType", mediaType); put("mediaId", mediaId); put("name", name)
                poster?.let { put("poster", it) }; videoTitle?.let { put("videoTitle", it) }
                season?.let { put("season", it) }; episode?.let { put("episode", it) }
                when {
                    clearPlaybackSource -> put("playbackSource", JsonNull)
                    playbackSource != null -> put("playbackSource", addonJson.encodeToJsonElement(playbackSource))
                }
                watched?.let { put("watched", it) }
                checkpointSessionId?.let { put("checkpointSessionId", it) }
                checkpointSequence?.let { put("checkpointSequence", it) }
                checkpointUpdatedAt?.let { put("checkpointUpdatedAt", it) }
                put("positionMs", positionMs.coerceAtLeast(0)); put("durationMs", durationMs.coerceAtLeast(0))
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to save playback progress", response.status.value)
        return response.body<ProgressItemResponse>().item
            ?: throw ServerRequestException("The server did not return playback progress")
    }

    suspend fun loadHomeCatalogs(addons: List<InstalledAddonSummary>): HomeCatalogResult = coroutineScope {
        val requests = addons
            .filter { it.enabled }
            .flatMap { addon ->
                addon.manifest["catalogs"]?.jsonArray.orEmpty()
                    .mapNotNull { it as? JsonObject }
                    .filter { catalog ->
                        catalog["extra"]?.jsonArray.orEmpty().none { extra ->
                            (extra as? JsonObject)?.get("isRequired")?.jsonPrimitive?.booleanOrNull == true
                        }
                    }
                    .mapNotNull { catalog ->
                        val id = catalog["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                        val type = catalog["type"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                        val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                        val title = formatCatalogTitle(
                            catalog["name"]?.jsonPrimitive?.contentOrNull ?: "$addonName · $id",
                            type,
                        )
                        Triple(addon, Pair(type, id), title)
                    }
            }
            .map { (addon, resource, title) ->
                async {
                    runCatching {
                        val (type, id) = resource
                        val manifestUrl = addon.manifestUrl.substringBefore('?').substringBefore('#')
                        val base = manifestUrl.substringBeforeLast('/', manifestUrl).trimEnd('/')
                        val url = "$base/catalog/${type.encodeURLPathPart()}/${id.encodeURLPathPart()}.json"
                        val response = client.get(url)
                        if (!response.status.isSuccess()) {
                            throw ServerRequestException("$title returned HTTP ${response.status.value}")
                        }
                        HomeCatalog(
                            key = "${addon.id}:$type:$id",
                            title = title,
                            items = response.decodeAddonBody<CatalogResponse>().metas,
                            addonId = addon.id,
                            type = type,
                            catalogId = id,
                        )
                    }
                }
            }
        val results = requests.map { it.await() }
        HomeCatalogResult(
            catalogs = results.mapNotNull { it.getOrNull() },
            failedRequests = results.count { it.isFailure },
        )
    }

    suspend fun loadMeta(addons: List<InstalledAddonSummary>, type: String, id: String): MetaItem {
        val key = "$type:$id"
        metadataCache[key]?.let { return it }
        val candidates = addons.filter { it.enabled && it.supportsResource("meta", type, id) }
        if (candidates.isEmpty()) throw ServerRequestException("No installed add-on provides metadata for this title")
        return supervisorScope {
            val results = Channel<Result<MetaItem>>(candidates.size)
            val jobs = candidates.map { addon -> launch {
                results.send(runCatching {
                    val response = client.get(resourceUrl(addon.manifestUrl, "meta", type, id))
                    if (!response.status.isSuccess()) error("metadata request failed")
                    response.decodeAddonBody<MetaResponse>(::normalizeMetaResponse).meta
                        ?: error("add-on returned no metadata")
                })
            } }
            var lastFailure: Throwable? = null
            repeat(candidates.size) {
                val result = results.receive()
                result.getOrNull()?.let { metadata ->
                    jobs.forEach { it.cancel() }
                    if (metadataCache.size >= 128) metadataCache.remove(metadataCache.keys.first())
                    metadataCache[key] = metadata
                    return@supervisorScope metadata
                }
                lastFailure = result.exceptionOrNull()
            }
            throw ServerRequestException(lastFailure?.message ?: "No installed add-on returned metadata for this title")
        }
    }

    suspend fun loadStreams(
        addons: List<InstalledAddonSummary>,
        type: String,
        videoId: String,
        debugLogging: Boolean = false,
    ): List<StreamSource> = coroutineScope {
        val results = addons.filter { it.enabled && it.supportsResource("stream", type, videoId) }.map { addon ->
            async {
                val started = TimeSource.Monotonic.markNow()
                val result = runCatching {
                    val response = client.get(resourceUrl(addon.manifestUrl, "stream", type, videoId))
                    if (!response.status.isSuccess()) {
                        throw ServerRequestException(
                            "Stream request returned HTTP ${response.status.value}",
                            response.status.value,
                        )
                    }
                    val name = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                    response.decodeAddonBody<StreamsResponse>().streams.map { StreamSource(addon.id, name, it) }
                }
                if (debugLogging) {
                    val failure = result.exceptionOrNull()
                    val status = (failure as? ServerRequestException)?.statusCode?.let { " status=$it" }.orEmpty()
                    LifecycleDiagnostics.event(
                        "streams.addon",
                        "addon=${addon.manifestId} outcome=${if (failure == null) "success" else "failure"}$status durationMs=${started.elapsedNow().inWholeMilliseconds}",
                    )
                }
                result
            }
        }.map { it.await() }
        val streams = results.flatMap { it.getOrDefault(emptyList()) }
        if (streams.isEmpty() && results.isNotEmpty() && results.all { it.isFailure }) {
            val reason = results.firstNotNullOfOrNull { it.exceptionOrNull()?.message }
            throw ServerRequestException(reason ?: "Every installed add-on failed to load streams")
        }
        streams
    }

    suspend fun loadSubtitles(addons: List<InstalledAddonSummary>, type: String, videoId: String): List<SubtitleItem> = coroutineScope {
        addons.filter { it.enabled && it.supportsResource("subtitles", type, videoId) }.map { addon ->
            async {
                runCatching {
                    val response = client.get(resourceUrl(addon.manifestUrl, "subtitles", type, videoId))
                    if (!response.status.isSuccess()) error("subtitle request failed")
                    val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                    response.decodeAddonBody<SubtitlesResponse>().subtitles.map { it.copy(addonName = addonName) }
                }.getOrDefault(emptyList())
            }
        }.flatMap { it.await() }.distinctBy(SubtitleItem::url)
    }

    suspend fun searchCatalogs(addons: List<InstalledAddonSummary>, query: String): List<HomeCatalog> = coroutineScope {
        val requests = addons.filter { it.enabled }.flatMap { addon ->
            addon.manifest["catalogs"]?.jsonArray.orEmpty().mapNotNull { it as? JsonObject }
                .filter { catalog ->
                    catalog["extra"]?.jsonArray.orEmpty().any { extra ->
                        (extra as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull == "search"
                    }
                }
                .mapNotNull { catalog ->
                    val type = catalog["type"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                    val id = catalog["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                    val name = catalog["name"]?.jsonPrimitive?.contentOrNull ?: id.replaceFirstChar(Char::uppercase)
                    SearchCatalogRequest(addon, type, id, name)
                }
        }.map { (addon, type, id, catalogName) ->
            async {
                runCatching {
                    val url = resourceUrl(addon.manifestUrl, "catalog", type, id, "search", query)
                    val response = client.get(url)
                    if (!response.status.isSuccess()) error("search failed")
                    val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                    val typeLabel = when (type.lowercase()) { "movie" -> "Movies"; "series" -> "Series"; else -> type.replaceFirstChar(Char::uppercase) }
                    HomeCatalog(
                        key = "search:${addon.id}:$type:$id",
                        title = "$catalogName · $typeLabel · $addonName",
                        items = response.decodeAddonBody<CatalogResponse>().metas.distinctBy { "${it.type}:${it.id}" },
                        addonId = addon.id,
                        type = type,
                        catalogId = id,
                    )
                }.getOrNull()
            }
        }
        requests.mapNotNull { it.await() }.filter { it.items.isNotEmpty() }
    }

    suspend fun loadCatalog(
        catalog: DiscoverCatalog,
        genre: String? = null,
        skip: Int = 0,
    ): List<CatalogItem> {
        val extras = buildList {
            genre?.let { add("genre" to it) }
            if (skip > 0) add("skip" to skip.toString())
        }
        val response = client.get(resourceUrl(catalog.manifestUrl, "catalog", catalog.type, catalog.id, extras))
        if (!response.status.isSuccess()) {
            throw ServerRequestException("${catalog.name} returned HTTP ${response.status.value}", response.status.value)
        }
        return response.decodeAddonBody<CatalogResponse>().metas
    }

    private fun resourceUrl(
        manifestUrl: String,
        resource: String,
        type: String,
        id: String,
        extraName: String? = null,
        extraValue: String? = null,
    ): String {
        val cleanManifest = manifestUrl.substringBefore('?').substringBefore('#')
        val base = cleanManifest.substringBeforeLast('/', cleanManifest).trimEnd('/')
        val path = "$base/${resource.encodeURLPathPart()}/${type.encodeURLPathPart()}/${id.encodeURLPathPart()}"
        return if (extraName != null && extraValue != null) {
            "$path/${extraName.encodeURLPathPart()}=${extraValue.encodeURLPathPart()}.json"
        } else "$path.json"
    }

    private fun resourceUrl(
        manifestUrl: String,
        resource: String,
        type: String,
        id: String,
        extras: List<Pair<String, String>>,
    ): String {
        if (extras.isEmpty()) return resourceUrl(manifestUrl, resource, type, id)
        val cleanManifest = manifestUrl.substringBefore('?').substringBefore('#')
        val base = cleanManifest.substringBeforeLast('/', cleanManifest).trimEnd('/')
        val path = "$base/${resource.encodeURLPathPart()}/${type.encodeURLPathPart()}/${id.encodeURLPathPart()}"
        val encodedExtras = extras.joinToString("&") { (name, value) ->
            "${name.encodeURLPathPart()}=${value.encodeURLPathPart()}"
        }
        return "$path/$encodedExtras.json"
    }

    suspend fun generateRecoveryCodes(baseUrl: String, token: String): List<String> {
        val response = client.post("$baseUrl/v1/auth/recovery-codes") { bearerAuth(token) }
        if (!response.status.isSuccess()) {
            throw ServerRequestException(
                "Recovery-code generation returned HTTP ${response.status.value}",
                response.status.value,
            )
        }
        return response.body<RecoveryCodesResponse>().codes
    }

    suspend fun authenticationMethods(baseUrl: String, token: String): AuthenticationMethods {
        val response = client.get("$baseUrl/v1/auth/methods") { bearerAuth(token) }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to load authentication methods", response.status.value)
        return response.body()
    }

    suspend fun setPasswordMode(baseUrl: String, token: String, enabled: Boolean, password: String? = null, currentPassword: String? = null): Boolean {
        val response = client.put("$baseUrl/v1/auth/password-mode") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("enabled", enabled)
                password?.let { put("password", it) }
                currentPassword?.let { put("currentPassword", it) }
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException(response.bodyAsText().takeIf(String::isNotBlank) ?: "Unable to update password", response.status.value)
        return response.body<PasswordModeResponse>().passwordEnabled
    }

    suspend fun startMobileAuth(
        baseUrl: String,
        challenge: String,
        callbackUrl: String = "conduit://oauth/callback",
    ): MobileAuthStart {
        val response = client.post("$baseUrl/v1/auth/mobile/start") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("callbackUrl", callbackUrl)
                    put("codeChallenge", challenge)
                },
            )
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException("OAuth start returned HTTP ${response.status.value}")
        }
        return response.body()
    }

    suspend fun startDesktopAuth(
        baseUrl: String,
        challenge: String,
        callbackUrl: String,
    ): DesktopAuthStart {
        val response = client.post("$baseUrl/v1/auth/desktop/start") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("callbackUrl", callbackUrl)
                    put("codeChallenge", challenge)
                },
            )
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException("OAuth start returned HTTP ${response.status.value}")
        }
        return response.body()
    }

    suspend fun exchangeMobileAuth(
        baseUrl: String,
        requestId: String,
        code: String,
        verifier: String,
    ): MobileAuthExchange {
        val response = client.post("$baseUrl/v1/auth/mobile/exchange") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("requestId", requestId)
                    put("code", code)
                    put("verifier", verifier)
                },
            )
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException("OAuth exchange was rejected", response.status.value)
        }
        return response.body()
    }

    suspend fun exchangeDesktopAuth(
        baseUrl: String,
        requestId: String,
        code: String,
        verifier: String,
    ): MobileAuthExchange {
        val response = client.post("$baseUrl/v1/auth/desktop/exchange") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("requestId", requestId)
                    put("code", code)
                    put("verifier", verifier)
                },
            )
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException("OAuth exchange returned HTTP ${response.status.value}")
        }
        return response.body()
    }

    fun close() = client.close()
}

expect fun createPlatformHttpClient(): HttpClient
