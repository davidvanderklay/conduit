package media.conduit.mobile

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import coil3.compose.AsyncImage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.launch
import media.conduit.mobile.account.PlaybackQueueItem
import kotlin.math.roundToInt

/**
 * Transient queue feedback surfaced through the app snackbar host. A tiny bus
 * keeps queue call sites decoupled from wherever the host happens to live.
 */
internal object QueueToasts {
    private val _notices = MutableSharedFlow<String>(
        extraBufferCapacity = 8,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val notices: SharedFlow<String> = _notices

    fun emit(notice: String) {
        _notices.tryEmit(notice)
    }
}

/**
 * The queue rows themselves, shared by the full drawer and the condensed
 * episode-drawer column. Owns reorder-by-long-press-drag with a lifted,
 * finger-tracking dragged row and animated neighbors.
 *
 * [onCommit] receives the new list after a drop or removal; pure reorders are
 * silent, removals emit their own toast.
 */
@Composable
internal fun QueueList(
    items: List<PlaybackQueueItem>,
    compact: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    onPlay: (PlaybackQueueItem) -> Unit,
    onCommit: suspend (List<PlaybackQueueItem>) -> Unit,
) {
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var displayed by remember(items) { mutableStateOf(items) }
    val latestItems by rememberUpdatedState(items)
    var draggingKey by remember { mutableStateOf<String?>(null) }
    var dragTranslationY by remember { mutableFloatStateOf(0f) }
    var rowHeightPx by remember { mutableStateOf(0) }
    var menuKey by remember { mutableStateOf<String?>(null) }
    val spacingDp = if (compact) 6.dp else 10.dp
    val spacingPx = with(density) { spacingDp.toPx() }
    // Measured rows keep swap thresholds honest under font scaling; this is
    // only the pre-first-layout estimate.
    val fallbackRowPx = with(density) { (if (compact) 52.dp else 68.dp).toPx() }

    LazyColumn(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(spacingDp),
        contentPadding = contentPadding,
    ) {
        items(displayed, key = PlaybackQueueItem::key) { item ->
            val isDragging = draggingKey == item.key
            val lift by animateFloatAsState(
                targetValue = if (isDragging) 1f else 0f,
                animationSpec = spring(stiffness = 380f),
                label = "queueRowLift",
            )
            // Placement animation fights manual drag tracking, so the dragged
            // row opts out while its neighbors glide.
            val placement = if (isDragging) Modifier else Modifier.animateItem()
            QueueItemRow(
                item = item,
                compact = compact,
                isDragging = isDragging,
                lift = lift,
                dragTranslationY = dragTranslationY,
                placement = placement,
                menuExpanded = menuKey == item.key,
                onMenuDismiss = { menuKey = null },
                onPlay = onPlay,
                onOpenMenu = { menuKey = item.key },
                onMeasure = { height -> rowHeightPx = height },
                onDragStart = {
                    draggingKey = item.key
                    dragTranslationY = 0f
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                },
                onDragEnd = {
                    draggingKey = null
                    dragTranslationY = 0f
                    if (displayed != latestItems) {
                        val committed = displayed
                        scope.launch { onCommit(committed) }
                    }
                },
                onDragCancel = {
                    draggingKey = null
                    dragTranslationY = 0f
                },
                onDrag = { amount ->
                    dragTranslationY += amount
                    val step = (rowHeightPx.takeIf { it > 0 } ?: fallbackRowPx.roundToInt()) + spacingPx
                    val current = displayed.indexOfFirst { it.key == item.key }
                    if (current >= 0) {
                        val target = (current + (dragTranslationY / step).roundToInt())
                            .coerceIn(0, displayed.lastIndex)
                        if (target != current) {
                            displayed = displayed.moveQueueItem(current, target)
                            dragTranslationY -= (target - current) * step
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        }
                    }
                },
                onRemove = {
                    menuKey = null
                    val next = displayed.removeFromQueue(item.key)
                    displayed = next
                    QueueToasts.emit("Removed from queue")
                    scope.launch { onCommit(next) }
                },
            )
        }
    }
}

@Composable
private fun QueueItemRow(
    item: PlaybackQueueItem,
    compact: Boolean,
    isDragging: Boolean,
    lift: Float,
    dragTranslationY: Float,
    placement: Modifier,
    menuExpanded: Boolean,
    onMenuDismiss: () -> Unit,
    onPlay: (PlaybackQueueItem) -> Unit,
    onOpenMenu: () -> Unit,
    onMeasure: (Int) -> Unit,
    onDragStart: () -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
    onDrag: (Float) -> Unit,
    onRemove: () -> Unit,
) {
    val cornerShape = RoundedCornerShape(if (compact) 12.dp else 16.dp)

    Row(
        placement
            .fillMaxWidth()
            .onSizeChanged { onMeasure(it.height) }
            .zIndex(if (isDragging) 1f else 0f)
            .graphicsLayer {
                translationY = if (isDragging) dragTranslationY else 0f
                scaleX = 1f + .04f * lift
                scaleY = 1f + .04f * lift
                alpha = 1f - .25f * lift
                shape = cornerShape
                shadowElevation = lift * (if (compact) 14f else 22f) * density
                clip = false
            }
            .clip(cornerShape)
            .background(Color.White.copy(.05f))
            .clickable { onPlay(item) }
            .padding(if (compact) 6.dp else 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Rounded.DragHandle,
            "Hold and drag to reorder",
            tint = Color.White.copy(.42f),
            modifier = Modifier
                .size(if (compact) 24.dp else 32.dp)
                .pointerInput(item.key) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { onDragStart() },
                        onDragCancel = { onDragCancel() },
                        onDragEnd = { onDragEnd() },
                        onDrag = { change, amount ->
                            change.consume()
                            onDrag(amount.y)
                        },
                    )
                },
        )
        if (!compact) {
            AsyncImage(
                model = item.artwork ?: item.poster,
                contentDescription = null,
                modifier = Modifier.size(76.dp, 46.dp).clip(RoundedCornerShape(7.dp)),
                contentScale = ContentScale.Crop,
            )
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                text = queueItemTitle(item),
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (!compact) {
                item.videoTitle?.let {
                    Text(
                        it,
                        color = Color.White.copy(.56f),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Box {
            IconButton(onClick = onOpenMenu, modifier = Modifier.size(if (compact) 30.dp else 36.dp)) {
                Icon(
                    Icons.Rounded.MoreVert,
                    "Queue item options",
                    tint = Color.White,
                    modifier = Modifier.size(if (compact) 18.dp else 22.dp),
                )
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = onMenuDismiss,
                containerColor = Color(0xFF171719),
            ) {
                DropdownMenuItem(
                    text = { Text("Play now") },
                    leadingIcon = { Icon(Icons.Rounded.PlayArrow, null) },
                    onClick = { onMenuDismiss(); onPlay(item) },
                )
                DropdownMenuItem(
                    text = { Text("Remove") },
                    leadingIcon = { Icon(Icons.Rounded.DeleteOutline, null) },
                    onClick = onRemove,
                )
            }
        }
    }
}

private fun queueItemTitle(item: PlaybackQueueItem): String =
    if (item.mediaType == "movie") {
        item.name
    } else {
        listOfNotNull(
            item.name,
            item.season?.let { "S${it}E${item.episode ?: 0}" },
        ).joinToString(" · ")
    }

/** Shared confirmation for wiping every queued item; playback continues regardless. */
@Composable
internal fun ClearQueueDialog(visible: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    if (!visible) return
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Clear queue?") },
        text = { Text("This removes every waiting movie and episode. Current playback will continue.") },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Clear", color = MaterialTheme.colorScheme.error) }
        },
    )
}
