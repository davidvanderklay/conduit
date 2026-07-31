package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable

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

class ServerRequestException(message: String) : Exception(message)

class ConduitApi(private val client: HttpClient = createPlatformHttpClient()) {
    suspend fun validate(baseUrl: String): ValidatedServer {
        val healthResponse = client.get("$baseUrl/health")
        if (!healthResponse.status.isSuccess()) {
            throw ServerRequestException("Health check returned HTTP ${healthResponse.status.value}")
        }
        if (healthResponse.body<ServerHealth>().status != "ok") {
            throw ServerRequestException("The server returned an unexpected health response")
        }

        val configResponse = client.get("$baseUrl/v1/auth/config")
        if (!configResponse.status.isSuccess()) {
            throw ServerRequestException("Authentication discovery returned HTTP ${configResponse.status.value}")
        }
        return ValidatedServer(configResponse.body())
    }

    suspend fun bootstrap(baseUrl: String, token: String): BootstrapResponse {
        val response = client.get("$baseUrl/v1/bootstrap") { bearerAuth(token) }
        if (!response.status.isSuccess()) {
            throw ServerRequestException(
                if (response.status.value == 401) "Your session has expired" else
                    "Synchronization returned HTTP ${response.status.value}",
            )
        }
        return response.body()
    }

    fun close() = client.close()
}

expect fun createPlatformHttpClient(): HttpClient
