package media.conduit.mobile.foundation

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val ConduitColors = darkColorScheme(
    primary = Color(0xFFB8A8FF),
    onPrimary = Color(0xFF281A5B),
    secondary = Color(0xFFCDC2F4),
    surface = Color(0xFF121116),
    surfaceVariant = Color(0xFF343139),
    error = Color(0xFFFFB4AB),
)

@Composable
fun ConduitTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ConduitColors, content = content)
}
