package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember

private class ConduitBackGestureHandler(
    var action: () -> Unit,
    var cancellationAction: (() -> Unit)?,
    var interactive: Boolean,
) : IosBackGestureHandler {
    override fun onBack() = action()
    override fun onBackCancelled() { cancellationAction?.invoke() }
    override fun supportsInteractiveBack() = interactive && cancellationAction != null
}

private class BackHandlerRegistration(
    val handler: ConduitBackGestureHandler,
) {
    var enabled = false
}

private var nextRegistrationId = 0L
private val registrations = linkedMapOf<Long, BackHandlerRegistration>()

private fun updateNativeBackHandler() {
    IosBackGestureBridgeFactory.bridge()?.update(
        registrations.values.lastOrNull { it.enabled }?.handler,
    )
}

@Composable
actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
    onBackCancelled: (() -> Unit)?,
    interactiveBack: Boolean,
) {
    val registration = remember {
        BackHandlerRegistration(ConduitBackGestureHandler(onBack, null, false)).also {
            registrations[++nextRegistrationId] = it
        }
    }
    SideEffect {
        registration.handler.action = onBack
        registration.handler.cancellationAction = onBackCancelled
        registration.handler.interactive = interactiveBack
        registration.enabled = enabled
        updateNativeBackHandler()
    }
    DisposableEffect(registration) {
        onDispose {
            registrations.entries.removeAll { it.value === registration }
            updateNativeBackHandler()
        }
    }
}

actual val platformBackIncludesFullscreenPlayer: Boolean = false
