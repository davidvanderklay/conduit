package media.conduit.client.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import kotlinx.browser.window
import org.w3c.dom.Storage

private class BrowserStore(
    private val storage: Storage,
    private val prefix: String,
) : SettingsStore, SecureStore {
    override fun get(key: String): String? = storage.getItem(prefix + key)
    override fun put(key: String, value: String) = storage.setItem(prefix + key, value)
    override fun remove(key: String) = storage.removeItem(prefix + key)
}

@Composable
actual fun rememberPlatformServices(): PlatformServices = remember {
    PlatformServices(
        settings = BrowserStore(window.localStorage, "conduit.client.settings."),
        // Session storage keeps browser bearer tokens out of persistent local storage.
        secure = BrowserStore(window.sessionStorage, "conduit.client.session."),
        info = PlatformInfo(
            name = "Web",
            version = "Wasm",
            device = "Browser",
        ),
    )
}

@Composable
actual fun rememberAppLifecycleEvents(
    onForeground: () -> Unit,
    onConnectivityRecovered: () -> Unit,
) {
    LaunchedEffect(Unit) { onForeground() }
}
