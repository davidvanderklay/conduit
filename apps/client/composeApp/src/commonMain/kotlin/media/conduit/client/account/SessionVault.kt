package media.conduit.client.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.client.foundation.SecureStore
import kotlin.time.Clock
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

@Serializable
data class StoredSession(
    val serverBaseUrl: String,
    val token: String,
    val expiresAt: String? = null,
)

@Serializable
data class PendingOAuth(
    val serverBaseUrl: String,
    val requestId: String,
    val verifier: String,
    val authorizationUrl: String,
    val expiresAt: String,
    val flow: OAuthFlow = OAuthFlow.Mobile,
)

class SessionVault(private val secureStore: SecureStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val key = "account.session.v1"
    private val oauthKey = "account.oauth-pending.v1"

    fun loadFor(serverBaseUrl: String): StoredSession? = secureStore.get(key)
        ?.let { runCatching { json.decodeFromString<StoredSession>(it) }.getOrNull() }
        ?.takeIf { it.serverBaseUrl == serverBaseUrl }

    fun save(session: StoredSession) = secureStore.put(key, json.encodeToString(session))

    fun clear() = secureStore.remove(key)

    fun pendingOAuth(
        serverBaseUrl: String,
        now: Instant = Clock.System.now(),
    ): PendingOAuth? {
        val pending = secureStore.get(oauthKey)
            ?.let { runCatching { json.decodeFromString<PendingOAuth>(it) }.getOrNull() }
            ?.takeIf { it.serverBaseUrl == serverBaseUrl }
            ?: return null
        val expiresAt = runCatching { Instant.parse(pending.expiresAt) }.getOrNull()
        if (expiresAt == null || expiresAt <= now + OAuthClockSkew) {
            clearPendingOAuth()
            return null
        }
        return pending
    }

    fun savePendingOAuth(value: PendingOAuth) =
        secureStore.put(oauthKey, json.encodeToString(value))

    fun clearPendingOAuth() = secureStore.remove(oauthKey)

    private companion object {
        val OAuthClockSkew = 30.seconds
    }
}
