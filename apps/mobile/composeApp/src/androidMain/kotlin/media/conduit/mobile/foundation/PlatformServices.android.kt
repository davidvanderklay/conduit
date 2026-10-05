package media.conduit.mobile.foundation

import android.content.SharedPreferences
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.content.Intent
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
                isTablet = isTabletSmallestWidth(context.resources.configuration.smallestScreenWidthDp),
            ),
            shareText = { text ->
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }
                context.startActivity(
                    Intent.createChooser(intent, "Share conduit debug logs")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            },
        )
    }
}

@Composable
actual fun rememberAppLifecycleEvents(
    onForeground: () -> Unit,
    onConnectivityRecovered: () -> Unit,
    onActiveChanged: (Boolean) -> Unit,
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current.applicationContext
    val connectivity = remember(context) {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    val latestForeground = rememberUpdatedState(onForeground)
    val latestConnectivity = rememberUpdatedState(onConnectivityRecovered)
    val latestActive = rememberUpdatedState(onActiveChanged)
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    DisposableEffect(lifecycle, connectivity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                latestActive.value(true)
                latestForeground.value()
            } else if (event == Lifecycle.Event.ON_PAUSE) latestActive.value(false)
        }
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                handler.post { if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) latestConnectivity.value() }
            }
        }
        lifecycle.addObserver(observer)
        connectivity.registerDefaultNetworkCallback(networkCallback)
        val active = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        latestActive.value(active)
        if (active) latestForeground.value()
        onDispose {
            lifecycle.removeObserver(observer)
            connectivity.unregisterNetworkCallback(networkCallback)
        }
    }
}
