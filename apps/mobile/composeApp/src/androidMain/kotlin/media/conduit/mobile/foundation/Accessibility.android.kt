package media.conduit.mobile.foundation

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext

@Composable
internal actual fun rememberSystemAccessibility(): SystemAccessibility {
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager }
    fun read() = SystemAccessibility(
        reduceMotion = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f,
        screenReader = manager.isTouchExplorationEnabled,
    )
    var settings by remember(context) { mutableStateOf(read()) }
    DisposableEffect(context, manager) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { settings = read() }
        }
        val listener = AccessibilityManager.TouchExplorationStateChangeListener { settings = read() }
        context.contentResolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        manager.addTouchExplorationStateChangeListener(listener)
        onDispose {
            context.contentResolver.unregisterContentObserver(observer)
            manager.removeTouchExplorationStateChangeListener(listener)
        }
    }
    return settings
}
