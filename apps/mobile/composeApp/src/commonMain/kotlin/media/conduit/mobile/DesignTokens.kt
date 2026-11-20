package media.conduit.mobile

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.material3.Text
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Corner radii: 8dp for media and small tiles, 12dp for buttons, fields, cards and menus, full for pills. */

/** Tertiary text such as add-on facts, genres, and episode dates: opaque, clearly a step below onSurfaceVariant. */
internal val TertiaryText = androidx.compose.ui.graphics.Color(0xFF85858F)

/** Hairline over artwork edges so dark posters keep their shape: 6% on AMOLED black, a fainter 4% on the zinc page. */
internal val ArtworkEdge: Color
    @Composable @ReadOnlyComposable
    get() = Color.White.copy(alpha = if (MaterialTheme.colorScheme.background == Color.Black) .06f else .04f)

/** Height of every full-size button: Play, onboarding, recovery, retry, and save. */
internal val PrimaryButtonHeight = 52.dp

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

/** Heading on sign-in, household setup, and recovery screens; the same size as every other page title. */
internal val OnboardingTitleStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = PageTitleStyle

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

/**
 * Cleans up a synopsis an add-on already cut short ("...when opposing forces col..."): drops the
 * partial word and trailing punctuation and ends with a single "…", so it never ends mid-word.
 */
internal fun tidyTruncatedText(text: String): String {
    val trimmed = text.trim()
    val body = when {
        trimmed.endsWith("...") -> trimmed.removeSuffix("...")
        trimmed.endsWith("…") -> trimmed.removeSuffix("…")
        else -> return trimmed
    }.trimEnd()
    val wholeWords = if (body.lastOrNull()?.isLetterOrDigit() == true && ' ' in body) body.substringBeforeLast(' ') else body
    return wholeWords.trimEnd(' ', ',', ';', ':', '.', '-') + "…"
}

/** Joins names so each one wraps as a unit ("New Zealand" never splits across lines). */
internal fun unbreakableNames(names: String): String =
    names.split(",").joinToString(", ") { it.trim().replace(' ', ' ') }

/**
 * Text limited to [maxLines] whose ellipsis always sits right after the last whole word, with no gap
 * or stray punctuation ("goes…", never "goes …" or "strategy.…"). It lays out once, cuts at the last
 * visible line's end, and drops one more word if the ellipsis still doesn't fit.
 */
@Composable
internal fun TidyEllipsisText(
    text: String,
    maxLines: Int,
    style: TextStyle,
    color: androidx.compose.ui.graphics.Color,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
) {
    // The cut depends on the width, so it starts over whenever the width changes. Otherwise a title first
    // measured in a narrow cell (while a grid settles) keeps that early cut at its final width.
    androidx.compose.foundation.layout.BoxWithConstraints(modifier) {
    var display by remember(text, maxLines, constraints.maxWidth) { mutableStateOf(text) }
    Text(
        display,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Clip,
        onTextLayout = { layout ->
            if (!layout.hasVisualOverflow) return@Text
            val current = display.removeSuffix("…")
            val end = if (display == text) layout.getLineEnd(maxLines - 1, visibleEnd = true).coerceAtMost(current.length) else current.length
            var cut = current.substring(0, end)
            // Keep a word only if the cut fell on whitespace; otherwise it is partial. After the first pass, drop a word.
            val cutOnBoundary = display == text && end < current.length && current[end].isWhitespace()
            // A single long word has no word to drop, so it loses a character instead ("MobL…", never "M…").
            if (!cutOnBoundary) cut = when {
                ' ' in cut.trimEnd() -> cut.trimEnd().substringBeforeLast(' ')
                display != text -> cut.dropLast(1)
                else -> cut
            }
            display = cut.trimEnd(' ', ',', ';', ':', '.', '-') + "…"
        },
    )
    }
}
