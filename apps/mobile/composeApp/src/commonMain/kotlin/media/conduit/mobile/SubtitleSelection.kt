package media.conduit.mobile

internal data class SubtitleCandidate<T>(
    val track: T,
    val language: String?,
    val title: String? = null,
    val embedded: Boolean,
    /** The container's forced flag, when the player exposes it. */
    val forced: Boolean = false,
)

private val ForcedSubtitleTitle = Regex("""\bforced\b|\bsigns\s*(?:&|and)\s*songs\b""", RegexOption.IGNORE_CASE)

/** Forced tracks carry the container flag or say so in their title, as signs-and-songs tracks do. Also called from the iOS mpv bridge. */
fun isForcedSubtitle(forced: Boolean, title: String?): Boolean =
    forced || title?.let(ForcedSubtitleTitle::containsMatchIn) == true

internal sealed interface SubtitleDecision<out T> {
    data object Wait : SubtitleDecision<Nothing>
    data object Off : SubtitleDecision<Nothing>
    data class Select<T>(val track: T) : SubtitleDecision<T>
}

internal fun matchesSubtitleLanguage(language: String, code: String?, title: String? = null): Boolean =
    trackLanguageCode(language)?.let { it == trackLanguageCode(code, title) } == true

/**
 * Language priority precedes embedded preference. An empty completed lookup
 * permits fallback. With [forcedOnly], only forced tracks are eligible.
 */
internal fun <T> preferredSubtitle(
    candidates: List<SubtitleCandidate<T>>,
    primary: String,
    secondary: String?,
    systemLanguage: String,
    embeddedReady: Boolean,
    addonsReady: Boolean,
    forcedOnly: Boolean = false,
): SubtitleDecision<T> {
    if (!embeddedReady) return SubtitleDecision.Wait
    val candidates = if (forcedOnly) candidates.filter { isForcedSubtitle(it.forced, it.title) } else candidates
    val languages = listOfNotNull(primary, secondary).mapNotNull {
        preferredLanguageCode(if (it == "System default") SystemLanguagePreference else it, systemLanguage)
    }.distinct()
    fun matching(language: String) = candidates.filter { matchesSubtitleLanguage(language, it.language, it.title) }
    languages.firstOrNull()?.let { language ->
        matching(language).firstOrNull { it.embedded }?.let { return SubtitleDecision.Select(it.track) }
    }
    if (!addonsReady) return SubtitleDecision.Wait
    languages.forEach { language ->
        val matching = matching(language)
        (matching.firstOrNull { it.embedded } ?: matching.firstOrNull())?.let {
            return SubtitleDecision.Select(it.track)
        }
    }
    return SubtitleDecision.Off
}
