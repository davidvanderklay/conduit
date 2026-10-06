package media.conduit.mobile.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.foundation.SecureStore
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
)

@Serializable
private data class CachedAccount(val session: StoredSession, val bootstrap: BootstrapResponse)

class SessionVault(private val secureStore: SecureStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val key = "account.session.v1"
    private val oauthKey = "account.oauth-pending.v1"
    private val accountKey = "account.bootstrap.v1"

    fun loadFor(serverBaseUrl: String): StoredSession? = secureStore.get(key)
        ?.let { runCatching { json.decodeFromString<StoredSession>(it) }.getOrNull() }
        ?.takeIf { it.serverBaseUrl == serverBaseUrl }

    fun save(session: StoredSession) = secureStore.put(key, json.encodeToString(session))

    fun saveBootstrap(session: StoredSession, bootstrap: BootstrapResponse) =
        secureStore.put(accountKey, json.encodeToString(CachedAccount(session, bootstrap)))

    /** Offline access needs a matching session with a known future expiry. */
    fun cachedAccount(serverBaseUrl: String, now: Instant = Clock.System.now()): AccountStatus.SignedIn? {
        val session = loadFor(serverBaseUrl) ?: return null
        val expiry = session.expiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
        if (expiry <= now) return null
        val cached = secureStore.get(accountKey)
            ?.let { runCatching { json.decodeFromString<CachedAccount>(it) }.getOrNull() }
            ?.takeIf { it.session == session } ?: return null
        return AccountStatus.SignedIn(session, cached.bootstrap, cached = true)
    }

    fun clear() {
        secureStore.remove(key)
        secureStore.remove(accountKey)
        clearPendingOAuth()
    }

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
