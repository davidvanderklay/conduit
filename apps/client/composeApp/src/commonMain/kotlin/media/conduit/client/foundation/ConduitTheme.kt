package media.conduit.client.foundation

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private fun conduitColors(amoledBlack: Boolean) = darkColorScheme(
    primary = Color(0xFFFBBF24),
    onPrimary = Color(0xFF09090B),
    primaryContainer = Color(0xFF422006),
    onPrimaryContainer = Color(0xFFFDE68A),
    secondary = Color(0xFFFCD34D),
    onSecondary = Color(0xFF18181B),
    secondaryContainer = Color(0xFF3D2B05),
    onSecondaryContainer = Color(0xFFFDE68A),
    tertiary = Color(0xFFF59E0B),
    onTertiary = Color(0xFF18181B),
    tertiaryContainer = Color(0xFF451A03),
    onTertiaryContainer = Color(0xFFFED7AA),
    background = Color.Black,
    onBackground = Color(0xFFF4F4F5),
    surface = Color.Black,
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF27272A),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainerLowest = Color(0xFF050506),
    surfaceContainerLow = Color(0xFF111113),
    surfaceContainer = Color(0xFF18181B),
    surfaceContainerHigh = Color(0xFF202023),
    surfaceContainerHighest = Color(0xFF27272A),
    outline = Color(0xFF3F3F46),
    error = Color(0xFFFFB4AB),
)

@Composable
fun ConduitTheme(amoledBlack: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = conduitColors(amoledBlack), content = content)
}
