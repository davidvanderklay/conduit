package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable

interface SettingsStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

interface SecureStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

data class PlatformInfo(
    val name: String,
    val version: String,
    val device: String,
    val p2pAvailable: Boolean = false,
)

data class PlatformServices(
    val settings: SettingsStore,
    val secure: SecureStore,
    val info: PlatformInfo,
)

@Composable
expect fun rememberPlatformServices(): PlatformServices

class MemorySettingsStore : SettingsStore {
    private val values = mutableMapOf<String, String>()

    override fun get(key: String): String? = values[key]
    override fun put(key: String, value: String) { values[key] = value }
    override fun remove(key: String) { values.remove(key) }
}

class MemorySecureStore : SecureStore {
    private val values = mutableMapOf<String, String>()

    override fun get(key: String): String? = values[key]
    override fun put(key: String, value: String) { values[key] = value }
    override fun remove(key: String) { values.remove(key) }
}
