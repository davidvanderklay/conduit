package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import platform.Foundation.NSUserDefaults
import platform.UIKit.UIDevice

private class AppleSettingsStore(private val defaults: NSUserDefaults) : SettingsStore {
    override fun get(key: String): String? = defaults.stringForKey(key)
    override fun put(key: String, value: String) { defaults.setObject(value, key) }
    override fun remove(key: String) { defaults.removeObjectForKey(key) }
}

@Composable
actual fun rememberPlatformServices(): PlatformServices = remember {
    val device = UIDevice.currentDevice
    PlatformServices(
        settings = AppleSettingsStore(NSUserDefaults.standardUserDefaults),
        // Replace with a Keychain-backed adapter before iOS authentication is enabled.
        secure = MemorySecureStore(),
        info = PlatformInfo(
            name = device.systemName,
            version = device.systemVersion,
            device = device.model,
        ),
    )
}
