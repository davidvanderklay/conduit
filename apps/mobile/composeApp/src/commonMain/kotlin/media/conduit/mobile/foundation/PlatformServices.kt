package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

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
    val isTablet: Boolean = false,
)

/** UIDevice reports "iPadOS" on iPads and "iOS" on iPhones. */
fun String.isIosPlatformName(): Boolean =
    equals("iOS", ignoreCase = true) || equals("iPadOS", ignoreCase = true)

fun PlatformInfo.isIpad(): Boolean = name.isIosPlatformName() && isTablet

fun isTabletSmallestWidth(smallestWidthDp: Int): Boolean = smallestWidthDp >= 600

data class PlatformServices(
    val settings: SettingsStore,
    val secure: SecureStore,
    val info: PlatformInfo,
    val shareText: (String) -> Unit = {},
)

@Composable
expect fun rememberPlatformServices(): PlatformServices

@Composable
expect fun rememberAppLifecycleEvents(
    onForeground: () -> Unit,
    onConnectivityRecovered: () -> Unit,
)

/**
 * Refreshes playback state when the app becomes active and periodically while
 * visible, covering connectivity recovery on platforms without a network callback.
 */
@Composable
fun rememberAppRecoveryTriggers(onRecovery: () -> Unit) {
    val latestRecovery = rememberUpdatedState(onRecovery)
    rememberAppLifecycleEvents(
        onForeground = { latestRecovery.value() },
        onConnectivityRecovered = { latestRecovery.value() },
    )
    LaunchedEffect(Unit) {
        while (isActive) {
            delay(30_000)
            latestRecovery.value()
        }
    }
}

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
