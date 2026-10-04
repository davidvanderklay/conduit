package media.conduit.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import media.conduit.mobile.foundation.ResumeBehavior
import kotlin.math.roundToInt

@Composable
internal fun ResumeBehaviorDialog(selected: ResumeBehavior, onSelect: (ResumeBehavior) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        containerColor = Color.Black,
        onDismissRequest = onDismiss,
        title = { Text("Resume behavior") },
        text = {
            Column {
                ResumeBehavior.entries.forEach { behavior ->
                    Row(Modifier.fillMaxWidth().clickable { onSelect(behavior) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(behavior == selected, null)
                        Spacer(Modifier.width(8.dp))
                        Text(behavior.label)
                    }
                }
            }
        },
        confirmButton = {},
    )
}

@Composable
internal fun ReadAheadDialog(seconds: Int?, onSave: (Int?) -> Unit, onDismiss: () -> Unit) {
    var automatic by remember { mutableStateOf(seconds == null) }
    var target by remember { mutableStateOf((seconds ?: 30).coerceIn(10, 120)) }
    AlertDialog(
        containerColor = Color.Black,
        onDismissRequest = onDismiss,
        title = { Text("Network read-ahead") },
        text = {
            Column {
                listOf(true to "Automatic", false to "Custom").forEach { (value, label) ->
                    Row(Modifier.fillMaxWidth().clickable { automatic = value }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(automatic == value, null)
                        Spacer(Modifier.width(8.dp))
                        Text(label)
                    }
                }
                if (!automatic) {
                    Text("$target seconds")
                    Slider(value = target.toFloat(), onValueChange = { target = it.roundToInt() }, valueRange = 10f..120f, steps = 109)
                }
                Text("Applies to the next playback. Memory limits may reduce the buffered duration.")
            }
        },
        confirmButton = { TextButton(onClick = { onSave(target.takeUnless { automatic }) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Give the resume action initial focus so a TV remote can answer the prompt. */
@Composable
internal fun PlaybackResumeDialog(positionMs: Long, onResume: () -> Unit, onRestart: () -> Unit, onDismiss: () -> Unit) {
    val focus = remember { FocusRequester() }
    AlertDialog(
        containerColor = Color.Black,
        onDismissRequest = onDismiss,
        title = { Text("Resume playback?") },
        text = { Text("Continue from ${resumePositionLabel(positionMs)}?") },
        confirmButton = { TextButton(onClick = onResume, modifier = Modifier.focusRequester(focus)) { Text("Resume") } },
        dismissButton = {
            Row {
                TextButton(onClick = onRestart) { Text("Start over") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
    LaunchedEffect(Unit) {
        withFrameNanos { }
        focus.requestFocus()
    }
}
