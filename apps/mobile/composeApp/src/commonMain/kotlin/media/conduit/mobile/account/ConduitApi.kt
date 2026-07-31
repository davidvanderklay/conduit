package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.statement.bodyAsText
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.patch
import io.ktor.client.request.put
import io.ktor.client.request.delete
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import io.ktor.http.encodeURLPathPart
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

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
data class BootstrapResponse(val households: List<HouseholdSummary>)

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
    val updatedAt: String,
)

@Serializable
data class LibraryResponse(val items: List<LibraryItemSummary>)

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
    val updatedAt: String,
)

@Serializable
data class ProgressResponse(val items: List<ProgressSummary>)
@Serializable private data class ProgressItemResponse(val item: ProgressSummary? = null)

@Serializable
data class ProfileSnapshot(
    val profileId: String,
    val addons: List<InstalledAddonSummary>,
    val library: List<LibraryItemSummary>,
    val progress: List<ProgressSummary>,
    val continueWatching: List<ProgressSummary> = emptyList(),
)

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
    val thumbnail: String? = null,
    val overview: String? = null,
    val description: String? = null,
)

@Serializable
data class MetaItem(
    val id: String,
    val type: String,
    val name: String,
    val poster: String? = null,
    val background: String? = null,
    val logo: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
    val runtime: String? = null,
    val genres: List<String> = emptyList(),
    val imdbRating: String? = null,
    val contentRating: String? = null,
    val director: List<String> = emptyList(),
    val cast: List<String> = emptyList(),
    val videos: List<VideoItem> = emptyList(),
)

@Serializable
data class StreamProxyHeaders(val request: Map<String, JsonElement> = emptyMap())
@Serializable
data class StreamBehaviorHints(val proxyHeaders: StreamProxyHeaders? = null, val filename: String? = null)
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

data class StreamSource(val addonName: String, val stream: StreamItem)

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

data class HomeCatalog(
    val key: String,
    val title: String,
    val items: List<CatalogItem>,
)

data class HomeCatalogResult(
    val catalogs: List<HomeCatalog>,
    val failedRequests: Int,
)

@Serializable
data class RecoveryCodesResponse(val codes: List<String>)

@Serializable
data class MobileAuthStart(
    val requestId: String,
    val expiresAt: String,
    val authorizationUrl: String,
)

@Serializable
data class MobileAuthExchange(val token: String, val expiresAt: String)

data class ValidatedServer(
    val authentication: AuthenticationConfiguration,
)

data class AuthenticatedSession(val token: String)

class ServerRequestException(message: String, val statusCode: Int? = null) : Exception(message)

class ConduitApi(private val client: HttpClient = createPlatformHttpClient()) {
    suspend fun validate(baseUrl: String): ValidatedServer {
        val healthResponse = client.get("$baseUrl/health")
        if (!healthResponse.status.isSuccess()) {
            throw ServerRequestException(
                "Health check returned HTTP ${healthResponse.status.value}",
                healthResponse.status.value,
            )
        }
        if (healthResponse.body<ServerHealth>().status != "ok") {
            throw ServerRequestException("The server returned an unexpected health response")
        }

        val configResponse = client.get("$baseUrl/v1/auth/config")
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
                put("name", "Conduit account")
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
        isKids: Boolean, usesPrimaryAddons: Boolean, avatarColor: String, avatarUrl: String?,
    ): ProfileSummary {
        val response = client.post("$baseUrl/v1/households/$householdId/profiles") {
            bearerAuth(token); contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", name.trim()); put("isKids", isKids); put("usesPrimaryAddons", usesPrimaryAddons); put("avatarColor", avatarColor)
                avatarUrl?.let { put("avatarUrl", it) }
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Profile creation returned HTTP ${response.status.value}", response.status.value)
        return response.body<ProfileResponse>().profile
    }

    suspend fun updateProfile(
        baseUrl: String, token: String, profileId: String, name: String,
        isKids: Boolean, usesPrimaryAddons: Boolean, avatarColor: String, avatarUrl: String?,
    ): ProfileSummary {
        val response = client.patch("$baseUrl/v1/profiles/$profileId") {
            bearerAuth(token); contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", name.trim()); put("isKids", isKids); put("usesPrimaryAddons", usesPrimaryAddons); put("avatarColor", avatarColor)
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

    suspend fun synchronizeProfile(baseUrl: String, token: String, profileId: String): ProfileSnapshot =
        coroutineScope {
            suspend fun get(path: String) = client.get("$baseUrl$path") { bearerAuth(token) }
            val addons = async { get("/v1/profiles/$profileId/addons") }
            val library = async { get("/v1/profiles/$profileId/library") }
            val progress = async { get("/v1/profiles/$profileId/progress?view=history&limit=250") }
            val continueWatching = async { get("/v1/profiles/$profileId/progress?view=continue&limit=14") }
            val responses = listOf(addons.await(), library.await(), progress.await(), continueWatching.await())
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
                progress = responses[2].body<ProgressResponse>().items,
                continueWatching = responses[3].body<ProgressResponse>().items,
            )
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
    ) {
        if (durationMs <= 0) return
        val response = client.put("$baseUrl/v1/profiles/$profileId/progress/${videoId.encodeURLPathPart()}") {
            bearerAuth(token); contentType(ContentType.Application.Json); setBody(buildJsonObject {
                put("mediaType", mediaType); put("mediaId", mediaId); put("name", name)
                poster?.let { put("poster", it) }; videoTitle?.let { put("videoTitle", it) }
                season?.let { put("season", it) }; episode?.let { put("episode", it) }
                put("positionMs", positionMs.coerceAtLeast(0)); put("durationMs", durationMs.coerceAtLeast(0))
            })
        }
        if (!response.status.isSuccess()) throw ServerRequestException("Unable to save playback progress", response.status.value)
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
                    .take(3)
                    .mapNotNull { catalog ->
                        val id = catalog["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                        val type = catalog["type"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                        val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                        val title = catalog["name"]?.jsonPrimitive?.contentOrNull ?: "$addonName · $id"
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
                            items = response.body<CatalogResponse>().metas,
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

    suspend fun loadMeta(addons: List<InstalledAddonSummary>, type: String, id: String): MetaItem = coroutineScope {
        val results = addons.filter { it.enabled }.map { addon ->
            async {
                runCatching {
                    val response = client.get(resourceUrl(addon.manifestUrl, "meta", type, id))
                    if (!response.status.isSuccess()) error("metadata request failed")
                    response.body<MetaResponse>().meta ?: error("add-on returned no metadata")
                }
            }
        }.map { it.await() }
        results.firstNotNullOfOrNull { it.getOrNull() }
            ?: throw ServerRequestException("No installed add-on returned metadata for this title")
    }

    suspend fun loadStreams(
        addons: List<InstalledAddonSummary>,
        type: String,
        videoId: String,
    ): List<StreamSource> = coroutineScope {
        val results = addons.filter { it.enabled }.map { addon ->
            async {
                runCatching {
                    val response = client.get(resourceUrl(addon.manifestUrl, "stream", type, videoId))
                    if (!response.status.isSuccess()) error("stream request failed")
                    val name = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                    response.body<StreamsResponse>().streams.map { StreamSource(name, it) }
                }
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
        addons.filter { it.enabled }.map { addon ->
            async {
                runCatching {
                    val response = client.get(resourceUrl(addon.manifestUrl, "subtitles", type, videoId))
                    if (!response.status.isSuccess()) error("subtitle request failed")
                    val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
                    response.body<SubtitlesResponse>().subtitles.map { it.copy(addonName = addonName) }
                }.getOrDefault(emptyList())
            }
        }.flatMap { it.await() }.distinctBy(SubtitleItem::url)
    }

    suspend fun searchCatalogs(addons: List<InstalledAddonSummary>, query: String): List<CatalogItem> = coroutineScope {
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
                    Triple(addon, type, id)
                }
        }.map { (addon, type, id) ->
            async {
                runCatching {
                    val url = resourceUrl(addon.manifestUrl, "catalog", type, id, "search", query)
                    val response = client.get(url)
                    if (!response.status.isSuccess()) error("search failed")
                    response.body<CatalogResponse>().metas
                }.getOrDefault(emptyList())
            }
        }
        requests.flatMap { it.await() }.distinctBy { "${it.type}:${it.id}" }
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

    suspend fun startMobileAuth(baseUrl: String, challenge: String): MobileAuthStart {
        val response = client.post("$baseUrl/v1/auth/mobile/start") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("callbackUrl", "conduit://oauth/callback")
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

    fun close() = client.close()
}

expect fun createPlatformHttpClient(): HttpClient
