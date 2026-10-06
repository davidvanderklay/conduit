package media.conduit.mobile

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

@Composable
internal actual fun rememberP2pEnvironment(): P2pEnvironment {
    val context = LocalContext.current.applicationContext
    return remember(context) { AndroidP2pEnvironment(context) }
}

internal class AndroidP2pEnvironment(context: Context) : P2pEnvironment {
    override val cacheDirectory = context.cacheDir.resolve("p2p").absolutePath
    private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    override fun appActive(): Boolean {
        val process = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(process)
        return process.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }
    override fun transfersAllowed(): Boolean {
        val network = connectivity.activeNetwork ?: return false
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) &&
            !power.isPowerSaveMode &&
            (Build.VERSION.SDK_INT < 29 || power.currentThermalStatus < PowerManager.THERMAL_STATUS_SEVERE)
    }
}
