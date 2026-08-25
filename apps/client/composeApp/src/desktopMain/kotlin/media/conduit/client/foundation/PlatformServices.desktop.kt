package media.conduit.client.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import java.util.prefs.Preferences

private class PreferencesSettingsStore(private val preferences: Preferences) : SettingsStore {
    override fun get(key: String): String? = preferences.get(key, null)
    override fun put(key: String, value: String) = preferences.put(key, value)
    override fun remove(key: String) = preferences.remove(key)
}

@Composable
actual fun rememberPlatformServices(): PlatformServices = remember {
    val osName = System.getProperty("os.name", "Desktop")
    PlatformServices(
        settings = PreferencesSettingsStore(Preferences.userRoot().node("media/conduit/client")),
        // Do not persist tokens until each desktop OS has a credential-store adapter.
        secure = MemorySecureStore(),
        info = PlatformInfo(
            name = osName,
            version = System.getProperty("os.version", ""),
            device = System.getProperty("os.arch", ""),
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
