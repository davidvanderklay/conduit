package media.conduit.mobile.foundation

import android.content.SharedPreferences
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalContext

private class AndroidSettingsStore(private val preferences: SharedPreferences) : SettingsStore {
    override fun get(key: String): String? = preferences.getString(key, null)
    override fun put(key: String, value: String) { preferences.edit().putString(key, value).apply() }
    override fun remove(key: String) { preferences.edit().remove(key).apply() }
}

@Composable
actual fun rememberPlatformServices(): PlatformServices {
    val context = LocalContext.current.applicationContext
    return remember(context) {
        PlatformServices(
            settings = AndroidSettingsStore(
                context.getSharedPreferences("conduit_device", 0),
            ),
            secure = AndroidSecureStore(
                context.getSharedPreferences("conduit_secure_values", 0),
            ),
            info = PlatformInfo(
                name = "Android",
                version = Build.VERSION.RELEASE,
                device = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            ),
        )
    }
}

@Composable
actual fun rememberAppLifecycleEvents(
    onForeground: () -> Unit,
    onConnectivityRecovered: () -> Unit,
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current.applicationContext
    val connectivity = remember(context) {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    val latestForeground = rememberUpdatedState(onForeground)
    val latestConnectivity = rememberUpdatedState(onConnectivityRecovered)
    DisposableEffect(lifecycle, connectivity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START || event == Lifecycle.Event.ON_RESUME) {
                latestForeground.value()
            }
        }
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                latestConnectivity.value()
            }
        }
        lifecycle.addObserver(observer)
        connectivity.registerDefaultNetworkCallback(networkCallback)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) latestForeground.value()
        onDispose {
            lifecycle.removeObserver(observer)
            connectivity.unregisterNetworkCallback(networkCallback)
        }
    }
}
