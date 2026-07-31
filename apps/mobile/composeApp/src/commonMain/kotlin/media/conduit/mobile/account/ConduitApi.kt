package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonObject
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
data class ProfileSummary(val id: String, val name: String, val isKids: Boolean)

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
    val positionMs: Long,
    val durationMs: Long,
    val watched: Boolean,
    val updatedAt: String,
)

@Serializable
data class ProgressResponse(val items: List<ProgressSummary>)

@Serializable
data class ProfileSnapshot(
    val profileId: String,
    val addons: List<InstalledAddonSummary>,
    val library: List<LibraryItemSummary>,
    val progress: List<ProgressSummary>,
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

    private suspend fun authenticate(url: String, credentials: JsonElement): AuthenticatedSession {
        val response = client.post(url) {
            contentType(ContentType.Application.Json)
            setBody(credentials)
        }
        if (!response.status.isSuccess()) {
            throw ServerRequestException(
                if (response.status.value == 401) "Incorrect email or password" else
                    "Authentication returned HTTP ${response.status.value}",
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

    suspend fun synchronizeProfile(baseUrl: String, token: String, profileId: String): ProfileSnapshot =
        coroutineScope {
            suspend fun get(path: String) = client.get("$baseUrl$path") { bearerAuth(token) }
            val addons = async { get("/v1/profiles/$profileId/addons") }
            val library = async { get("/v1/profiles/$profileId/library") }
            val progress = async { get("/v1/profiles/$profileId/progress?view=history&limit=250") }
            val responses = listOf(addons.await(), library.await(), progress.await())
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
            )
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
