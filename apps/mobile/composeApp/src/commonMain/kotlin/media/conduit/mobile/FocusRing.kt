package media.conduit.mobile

import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal val FocusRingColor = Color(0xFFFBBF24)

/**
 * Draws a ring while the focus target that follows in the chain (or sits inside)
 * holds D-pad or keyboard focus, and reports when it gains focus.
 */
internal fun Modifier.focusRing(
    shape: Shape = RoundedCornerShape(12.dp),
    color: Color = FocusRingColor,
    width: Dp = 2.dp,
    onFocused: () -> Unit = {},
): Modifier = composed {
    var focused by remember { mutableStateOf(false) }
    onFocusChanged { state ->
        if (state.hasFocus && !focused) onFocused()
        focused = state.hasFocus
    }.then(if (focused) Modifier.border(width, color, shape) else Modifier)
}

/** Where a panel wants D-pad focus to start. Unset on touch devices. */
internal val LocalInitialFocus = compositionLocalOf<FocusRequester?> { null }

/** Marks this control as the panel's starting focus target when [preferred] is true. */
internal fun Modifier.initialFocus(preferred: Boolean): Modifier = composed {
    val requester = LocalInitialFocus.current
    if (preferred && requester != null) focusRequester(requester) else this
}

/**
 * Tap handling for scrims and panel backgrounds. Unlike `clickable`, it adds no
 * focus target, so a remote cannot land on the scrim.
 */
internal fun Modifier.onTap(onTap: () -> Unit): Modifier =
    pointerInput(onTap) { detectTapGestures { onTap() } }

/**
 * Keeps focus inside an overlay until it closes. The trap also cancels
 * programmatic focus requests, so release it while a layer above is open.
 */
internal fun Modifier.focusTrap(enabled: Boolean = true): Modifier =
    focusProperties { onExit = { if (enabled) cancelFocusChange() } }.focusGroup()

/**
 * Lets Up and Down leave a single-line text field no matter which input device
 * sent the key; Compose only does this for devices that report a D-pad source.
 */
internal fun Modifier.dpadLeavesField(): Modifier = composed {
    val focusManager = LocalFocusManager.current
    onPreviewKeyEvent { event ->
        val direction = when (event.key) {
            Key.DirectionUp -> FocusDirection.Up
            Key.DirectionDown -> FocusDirection.Down
            else -> return@onPreviewKeyEvent false
        }
        if (event.type == KeyEventType.KeyDown) focusManager.moveFocus(direction)
        true
    }
}
