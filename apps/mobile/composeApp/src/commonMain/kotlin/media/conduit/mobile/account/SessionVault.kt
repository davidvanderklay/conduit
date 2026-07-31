package media.conduit.mobile.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.foundation.SecureStore

@Serializable
data class StoredSession(
    val serverBaseUrl: String,
    val token: String,
    val expiresAt: String,
)

class SessionVault(private val secureStore: SecureStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val key = "account.session.v1"

    fun loadFor(serverBaseUrl: String): StoredSession? = secureStore.get(key)
        ?.let { runCatching { json.decodeFromString<StoredSession>(it) }.getOrNull() }
        ?.takeIf { it.serverBaseUrl == serverBaseUrl }

    fun save(session: StoredSession) = secureStore.put(key, json.encodeToString(session))

    fun clear() = secureStore.remove(key)
}
