package media.conduit.mobile

internal data class SubtitleCandidate<T>(
    val track: T,
    val language: String?,
    val title: String? = null,
    val embedded: Boolean,
)

internal sealed interface SubtitleDecision<out T> {
    data object Wait : SubtitleDecision<Nothing>
    data object Off : SubtitleDecision<Nothing>
    data class Select<T>(val track: T) : SubtitleDecision<T>
}

internal fun matchesSubtitleLanguage(language: String, code: String?, title: String? = null): Boolean =
    trackLanguageCode(language)?.let { it == trackLanguageCode(code, title) } == true

/** Language priority precedes embedded preference. An empty completed lookup permits fallback. */
internal fun <T> preferredSubtitle(
    candidates: List<SubtitleCandidate<T>>,
    primary: String,
    secondary: String?,
    systemLanguage: String,
    embeddedReady: Boolean,
    addonsReady: Boolean,
): SubtitleDecision<T> {
    if (!embeddedReady) return SubtitleDecision.Wait
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
