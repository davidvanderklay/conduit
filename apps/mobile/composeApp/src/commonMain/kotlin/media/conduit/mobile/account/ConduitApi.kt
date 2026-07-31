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

    fun close() = client.close()
}

expect fun createPlatformHttpClient(): HttpClient
