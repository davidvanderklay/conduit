package media.conduit.mobile.foundation

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp

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
    background = if (amoledBlack) Color.Black else Color(0xFF09090B),
    onBackground = Color(0xFFF4F4F5),
    surface = if (amoledBlack) Color.Black else Color(0xFF09090B),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF27272A),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainerLowest = Color(0xFF050506),
    surfaceContainerLow = Color(0xFF111113),
    // On pure black, the default container blooms; AMOLED uses a slightly darker one.
    surfaceContainer = if (amoledBlack) Color(0xFF121214) else Color(0xFF18181B),
    surfaceContainerHigh = Color(0xFF202023),
    surfaceContainerHighest = Color(0xFF27272A),
    outline = Color(0xFF3F3F46),
    error = Color(0xFFFFB4AB),
)

/** Material defaults with tracking removed from body, title, and label styles for a tighter, less stock look. */
private val conduitTypography = Typography().run {
    copy(
        bodyLarge = bodyLarge.copy(letterSpacing = 0.sp),
        bodyMedium = bodyMedium.copy(letterSpacing = 0.sp),
        bodySmall = bodySmall.copy(letterSpacing = 0.sp),
        titleMedium = titleMedium.copy(letterSpacing = 0.sp),
        titleSmall = titleSmall.copy(letterSpacing = 0.sp),
        labelLarge = labelLarge.copy(letterSpacing = 0.sp),
        labelMedium = labelMedium.copy(letterSpacing = 0.sp),
        labelSmall = labelSmall.copy(letterSpacing = 0.sp),
    )
}

@Composable
fun ConduitTheme(amoledBlack: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = conduitColors(amoledBlack), typography = conduitTypography, content = content)
}
