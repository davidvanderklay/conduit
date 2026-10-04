package media.conduit.mobile.tv

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import media.conduit.mobile.dpadLeavesField
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.focusable
import media.conduit.mobile.focusTrap

/** Android TV and Google TV report the television UI mode; tablets and phones do not. */
internal fun Context.isTelevision(): Boolean =
    (getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType ==
        Configuration.UI_MODE_TYPE_TELEVISION

internal object TvColors {
    val Amber = Color(0xFFFBBF24)
    val AmberSoft = Color(0xFFFCD34D)
    val OnAmber = Color(0xFF09090B)
    val Panel = Color(0xD109090B)
    val Hairline = Color.White.copy(alpha = .10f)
    val Control = Color.White.copy(alpha = .08f)
    val ControlFocused = Color.White.copy(alpha = .16f)
    val Muted = Color(0xFFA1A1AA)
    val Dim = Color(0xFF71717A)
}

/** Overscan-safe page margins for a 960 x 540 dp television canvas. */
internal object TvSpacing {
    val Edge = 28.dp
    val Rail = 76.dp
}

/**
 * Remembers which item last held focus so a screen can hand focus back to it
 * after a details page, drawer, or menu closes.
 */
internal class TvFocusMemory {
    var key by mutableStateOf<String?>(null)
    val requester = FocusRequester()

    /** Returns false when the remembered item is no longer composed. */
    fun restore(): Boolean = runCatching { requester.requestFocus() }.getOrDefault(false)
}

internal fun Modifier.tvRememberFocus(memory: TvFocusMemory, key: String): Modifier =
    (if (memory.key == key) focusRequester(memory.requester) else this)
        .onFocusChanged { if (it.hasFocus) memory.key = key }

/** The Menu key mirrors a long press so every long-press action has a one-key path. */
internal fun Modifier.tvMenuKey(onMenu: (() -> Unit)?): Modifier =
    if (onMenu == null) this else onPreviewKeyEvent { event ->
        if (event.key == Key.Menu && event.type == KeyEventType.KeyUp) {
            onMenu()
            true
        } else {
            event.key == Key.Menu
        }
    }

/** A focusable, selectable container: the building block for TV buttons, rows, and tiles. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun TvFocusable(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(10.dp),
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    onFocused: () -> Unit = {},
    container: (focused: Boolean) -> Color = { if (it) TvColors.ControlFocused else Color.Transparent },
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier
            .onFocusChanged { state ->
                if (state.isFocused && !focused) onFocused()
                focused = state.isFocused
            }
            .tvMenuKey(onLongClick)
            .background(container(focused), shape)
            .then(if (focused) Modifier.border(2.dp, TvColors.Amber, shape) else Modifier)
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = enabled,
                onClick = onClick,
                onLongClick = onLongClick,
            ),
    ) { content(focused) }
}

@Composable
internal fun TvButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    enabled: Boolean = true,
) {
    val content = when {
        !enabled -> Color.White.copy(alpha = .34f)
        primary -> TvColors.OnAmber
        else -> Color.White
    }
    TvFocusable(
        onClick = onClick,
        modifier = modifier.defaultMinSize(minHeight = 40.dp),
        enabled = enabled,
        container = { focused ->
            when {
                primary && enabled -> if (focused) Color.White else TvColors.Amber
                focused -> TvColors.ControlFocused
                else -> TvColors.Control
            }
        },
    ) {
        Row(
            Modifier.align(Alignment.Center).padding(horizontal = 16.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            icon?.let { Icon(it, null, tint = content, modifier = Modifier.size(18.dp)) }
            Text(label, color = content, fontWeight = FontWeight.SemiBold, maxLines = 1, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
internal fun TvIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    size: Dp = 44.dp,
    badge: String? = null,
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier.size(size),
        shape = RoundedCornerShape(50),
        container = { focused ->
            when {
                focused -> TvColors.ControlFocused
                selected -> TvColors.Amber.copy(alpha = .15f)
                else -> Color.Transparent
            }
        },
    ) {
        Icon(
            icon,
            label,
            tint = if (selected) TvColors.AmberSoft else Color.White,
            modifier = Modifier.align(Alignment.Center).size(size * .5f),
        )
        badge?.let {
            Text(
                it,
                color = TvColors.OnAmber,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd)
                    .background(TvColors.Amber, RoundedCornerShape(50))
                    .padding(horizontal = 5.dp),
            )
        }
    }
}

/**
 * A text field for remote input. D-pad focus lands on the field without raising
 * the keyboard, so focus can pass through it; Select starts editing and opens
 * the on-screen keyboard, and Up or Down leaves the field again.
 */
@Composable
internal fun TvTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    onImeAction: () -> Unit = {},
) {
    var focused by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var editorFocused by remember { mutableStateOf(false) }
    val editor = remember { FocusRequester() }
    val shape = RoundedCornerShape(10.dp)
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(editing) { if (editing) editor.requestFocus() }
    Box(
        modifier
            .onFocusChanged { focused = it.hasFocus }
            .onPreviewKeyEvent { event ->
                val select = event.key == Key.DirectionCenter || event.key == Key.Enter || event.key == Key.NumPadEnter
                if (!select) return@onPreviewKeyEvent false
                if (event.type == KeyEventType.KeyDown) {
                    if (editing) keyboard?.show() else editing = true
                }
                true
            }
            .focusable(!editing)
            .background(if (focused) TvColors.ControlFocused else TvColors.Control, shape)
            .border(if (focused) 2.dp else 1.dp, if (focused) TvColors.Amber else TvColors.Hairline, shape)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        androidx.compose.foundation.layout.Column {
            Text(label, color = TvColors.Muted, style = MaterialTheme.typography.labelSmall)
            Box(Modifier.padding(top = 2.dp)) {
                if (value.isEmpty()) {
                    Text(placeholder, color = TvColors.Dim, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color.White),
                    cursorBrush = SolidColor(TvColors.Amber),
                    visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
                    keyboardActions = KeyboardActions(
                        onNext = { focusManager.moveFocus(FocusDirection.Down) },
                        onDone = {
                            keyboard?.hide()
                            onImeAction()
                        },
                        onSearch = { keyboard?.hide() },
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(editor)
                        .focusProperties { canFocus = editing }
                        .onFocusChanged { state ->
                            // Editing ends when focus moves on, so the next visit starts without the keyboard.
                            if (editorFocused && !state.isFocused) editing = false
                            editorFocused = state.isFocused
                        }
                        .dpadLeavesField(),
                )
            }
        }
    }
}

/** Small uppercase section label used across TV panels, matching the desktop app. */
@Composable
internal fun TvSectionLabel(text: String, modifier: Modifier = Modifier, color: Color = TvColors.Dim) {
    Text(
        text.uppercase(),
        color = color,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = androidx.compose.ui.unit.TextUnit(1.6f, androidx.compose.ui.unit.TextUnitType.Sp),
        modifier = modifier,
    )
}

/**
 * Keeps focus inside an overlay until it closes. The trap also cancels
 * programmatic focus requests, so release it while a layer above is open.
 */
internal fun Modifier.tvFocusTrap(enabled: Boolean = true): Modifier = focusTrap(enabled)

/** Stops D-pad focus from wandering into content that an overlay currently covers. */
internal fun Modifier.tvFocusBlocked(blocked: Boolean): Modifier =
    focusProperties { onEnter = { if (blocked) cancelFocusChange() } }.focusGroup()

/** Requests focus once the target is attached; lazy list items attach a frame or two late. */
internal suspend fun FocusRequester.requestFocusWhenReady(attempts: Int = 30): Boolean {
    repeat(attempts) {
        if (runCatching { requestFocus() }.getOrDefault(false)) return true
        androidx.compose.runtime.withFrameNanos { }
    }
    return false
}

/** True while the fullscreen player covers the app, so screens beneath know to yield focus. */
internal val LocalTvPlayerOpen = androidx.compose.runtime.compositionLocalOf { false }
