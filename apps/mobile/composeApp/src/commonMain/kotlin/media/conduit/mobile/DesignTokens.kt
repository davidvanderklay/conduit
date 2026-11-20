package media.conduit.mobile

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Corner radii: 8dp for media and small tiles, 12dp for buttons, fields, cards and menus, full for pills. */

/** Horizontal page gutter shared by phone screens. */
internal val PageGutter = 16.dp

/** Title of a top-level or settings page, e.g. "Library" or "Playback". */
internal val PageTitleStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.typography.headlineSmall.copy(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.25).sp)

/** Title above a shelf or row of posters. */
internal val ShelfTitleStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.typography.titleMedium.copy(fontSize = 19.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)

/** Group label above a settings group. Sentence case, primary text color, so it reads as a heading, not an eyebrow. */
internal val SectionLabelStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.typography.labelLarge.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)

/** Heading on sign-in, household setup, and recovery screens. */
internal val OnboardingTitleStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.typography.headlineMedium.copy(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.25).sp)

/** Filled input colors shared by search, URL, and onboarding fields: no outline until focused. */
@Composable
internal fun conduitFilledFieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
    disabledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
    errorContainerColor = MaterialTheme.colorScheme.surfaceContainer,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    disabledIndicatorColor = Color.Transparent,
)

/** Credits table text on the details page: a step below the synopsis. */
internal val CreditTextStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, lineHeight = 18.sp)

/** Title of a settings row: one step below body text so lists stay dense. */
internal val SettingsTitleStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
