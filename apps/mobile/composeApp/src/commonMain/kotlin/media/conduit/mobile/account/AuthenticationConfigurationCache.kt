package media.conduit.mobile.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.foundation.SettingsStore

/** Stores non-secret authentication discovery results per server for instant signed-out startup. */
class AuthenticationConfigurationCache(private val settings: SettingsStore) {
    private val json = Json { ignoreUnknownKeys = true }

    fun load(serverBaseUrl: String): AuthenticationConfiguration? = entries()[serverBaseUrl]

    fun save(serverBaseUrl: String, configuration: AuthenticationConfiguration) {
        settings.put(Key, json.encodeToString(Cache(entries() + (serverBaseUrl to configuration))))
    }

    private fun entries(): Map<String, AuthenticationConfiguration> = settings.get(Key)
        ?.let { runCatching { json.decodeFromString<Cache>(it) }.getOrNull() }
        ?.entries
        .orEmpty()

    @Serializable
    private data class Cache(val entries: Map<String, AuthenticationConfiguration>)

    private companion object {
        const val Key = "account.authentication-config.v1"
    }
}
