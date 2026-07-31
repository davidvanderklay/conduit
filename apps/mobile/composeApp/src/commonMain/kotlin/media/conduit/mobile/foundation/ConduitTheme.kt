package media.conduit.mobile.foundation

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val ConduitColors = darkColorScheme(
    primary = Color(0xFFFBBF24),
    onPrimary = Color(0xFF09090B),
    primaryContainer = Color(0xFF422006),
    onPrimaryContainer = Color(0xFFFDE68A),
    secondary = Color(0xFFFCD34D),
    onSecondary = Color(0xFF18181B),
    background = Color(0xFF09090B),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF09090B),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF27272A),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF3F3F46),
    error = Color(0xFFFFB4AB),
)

@Composable
fun ConduitTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ConduitColors, content = content)
}
