package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import platform.Foundation.NSUserDefaults
import platform.Foundation.NSNotificationCenter
import platform.UIKit.UIApplicationDidBecomeActiveNotification
import platform.UIKit.UIApplicationWillResignActiveNotification
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationState.UIApplicationStateActive
import platform.UIKit.UIDevice
import platform.UIKit.UIUserInterfaceIdiomPad

private class AppleSettingsStore(private val defaults: NSUserDefaults) : SettingsStore {
    override fun get(key: String): String? = defaults.stringForKey(key)
    override fun put(key: String, value: String) { defaults.setObject(value, key) }
    override fun remove(key: String) { defaults.removeObjectForKey(key) }
}

private class AppleKeychainStore(private val bridge: IosSecureStoreBridge) : SecureStore {
    override fun get(key: String): String? = bridge.get(key)

    override fun put(key: String, value: String) {
        checkKeychainStatus("write", bridge.put(key, value))
    }

    override fun remove(key: String) {
        checkKeychainStatus("remove", bridge.remove(key))
    }

    private fun checkKeychainStatus(operation: String, status: Int) {
        check(status == 0) { "iOS Keychain $operation failed with status $status" }
    }
}

@Composable
actual fun rememberPlatformServices(): PlatformServices = remember {
    val device = UIDevice.currentDevice
    PlatformServices(
        settings = AppleSettingsStore(NSUserDefaults.standardUserDefaults),
        secure = AppleKeychainStore(
            checkNotNull(IosPlatformBridgeFactory.secureStore()) {
                "The iOS Keychain bridge was not registered by the application host"
            },
        ),
        info = PlatformInfo(
            name = device.systemName,
            version = device.systemVersion,
            device = device.model,
            isTablet = device.userInterfaceIdiom == UIUserInterfaceIdiomPad,
        ),
        shareText = { text -> IosPlatformBridgeFactory.shareBridge()?.shareText(text) },
    )
}

@Composable
actual fun rememberAppLifecycleEvents(
    onForeground: () -> Unit,
    onConnectivityRecovered: () -> Unit,
    onActiveChanged: (Boolean) -> Unit,
) {
    val latestForeground = rememberUpdatedState(onForeground)
    val latestActive = rememberUpdatedState(onActiveChanged)
    val latestConnectivity = rememberUpdatedState(onConnectivityRecovered)
    DisposableEffect(Unit) {
        val events = IosPlatformBridgeFactory.appEvents()
        val subscription = events?.startConnectivity { if (UIApplication.sharedApplication.applicationState == UIApplicationStateActive) latestConnectivity.value() }
        latestActive.value(UIApplication.sharedApplication.applicationState == UIApplicationStateActive)
        val inactiveObserver = NSNotificationCenter.defaultCenter.addObserverForName(
            name = UIApplicationWillResignActiveNotification, `object` = null, queue = null,
        ) { _ -> latestActive.value(false) }
        val observer = NSNotificationCenter.defaultCenter.addObserverForName(
            name = UIApplicationDidBecomeActiveNotification,
            `object` = null,
            queue = null,
        ) { _ -> latestActive.value(true); latestForeground.value() }
        onDispose {
            subscription?.let { events?.stopConnectivity(it) }
            NSNotificationCenter.defaultCenter.removeObserver(observer)
            NSNotificationCenter.defaultCenter.removeObserver(inactiveObserver)
        }
    }
}
