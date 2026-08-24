package media.conduit.mobile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Carries keyboard visibility from the native iOS window into Compose. */
object PlatformKeyboard {
    var visible: Boolean by mutableStateOf(false)
        private set

    fun publish(visible: Boolean) {
        this.visible = visible
    }
}
