package media.conduit.mobile.foundation

import android.content.SharedPreferences
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
