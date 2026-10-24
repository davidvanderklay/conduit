package media.conduit.mobile

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import media.conduit.mobile.foundation.DevicePreferences
import media.conduit.mobile.foundation.SettingsStore

/**
 * Stored subtitle choice for a title watched with subtitles off. No language
 * code resolves from it, so every player's subtitle selection turns subtitles off.
 */
const val SubtitlesOff = "none"

/**
 * Track languages a profile last picked for one title. They apply ahead of the
 * global language preferences, so a series keeps its audio and subtitles
 * across episodes and sources. Null fields fall back to the global preference.
 */
@Serializable
data class TitlePlaybackChoices(
    val audioLanguage: String? = null,
    /** Language code, or [SubtitlesOff]. */
    val subtitleLanguage: String? = null,
    /** Positive values show subtitles later. */
    val subtitleDelayMs: Long? = null,
)

/** Fine and coarse steps offered by the delay controls. */
val SubtitleDelayStepsMs = listOf(-1_000L, -100L, 100L, 1_000L)
private const val SubtitleDelayLimitMs = 30_000L

/** The delay after one press of a delay control, kept within ±30 s. */
fun stepSubtitleDelay(delayMs: Long, stepMs: Long): Long =
    (kotlin.math.round((delayMs + stepMs) / 100.0).toLong() * 100).coerceIn(-SubtitleDelayLimitMs, SubtitleDelayLimitMs)

fun formatSubtitleDelay(delayMs: Long): String {
    val tenths = kotlin.math.abs(delayMs) / 100
    val seconds = "${tenths / 10}.${tenths % 10} s"
    return when {
        delayMs > 0 -> "+$seconds"
        delayMs < 0 -> "−$seconds"
        else -> seconds
    }
}

/** Language preferences a player receives for one title. */
data class PlaybackLanguagePreferences(
    val audio: String,
    val subtitle: String,
    val secondarySubtitle: String?,
    val forcedSubtitlesOnly: Boolean,
)

/**
 * A remembered subtitle language goes first and the global primary becomes its
 * fallback. Off has no fallback. A remembered subtitle pick also overrides
 * forced-only mode, so a title the viewer watches with full subtitles keeps them.
 */
fun DevicePreferences.languagesFor(choices: TitlePlaybackChoices) = PlaybackLanguagePreferences(
    audio = choices.audioLanguage ?: preferredAudioLanguage,
    subtitle = choices.subtitleLanguage ?: preferredSubtitleLanguage,
    secondarySubtitle = when (choices.subtitleLanguage) {
        null -> secondarySubtitleLanguage
        SubtitlesOff -> null
        else -> preferredSubtitleLanguage
    },
    forcedSubtitlesOnly = forcedSubtitlesOnly && choices.subtitleLanguage == null,
)

/** The choice to remember after a manual audio pick. Tracks without a recognizable language are not remembered. */
fun audioChoice(language: String?, label: String?) =
    TitlePlaybackChoices(audioLanguage = trackLanguageCode(language, label))

/** The choice to remember after a manual subtitle pick, or after turning subtitles off. */
fun subtitleChoice(enabled: Boolean, language: String?, label: String?) =
    TitlePlaybackChoices(subtitleLanguage = if (enabled) trackLanguageCode(language, label) else SubtitlesOff)

/** Per-profile, per-title choices kept on this device. Only the most recently used titles are kept. */
class TitlePlaybackRepository(private val store: SettingsStore) {
    fun load(identity: PlaybackIdentity): TitlePlaybackChoices = read()[key(identity)] ?: TitlePlaybackChoices()

    /** Merges the non-null fields of [choice] into the title's stored choices. */
    fun remember(identity: PlaybackIdentity, choice: TitlePlaybackChoices) {
        if (choice == TitlePlaybackChoices()) return
        val entries = read()
        val key = key(identity)
        val current = entries.remove(key) ?: TitlePlaybackChoices()
        entries[key] = TitlePlaybackChoices(
            audioLanguage = choice.audioLanguage ?: current.audioLanguage,
            subtitleLanguage = choice.subtitleLanguage ?: current.subtitleLanguage,
            subtitleDelayMs = choice.subtitleDelayMs ?: current.subtitleDelayMs,
        )
        // Insertion order tracks recency, so the oldest titles come first.
        val kept = entries.entries.toList().takeLast(TitleLimit).associate { it.key to it.value }
        store.put(StorageKey, ProtocolJson.encodeToString(kept))
    }

    private fun read(): LinkedHashMap<String, TitlePlaybackChoices> = store.get(StorageKey)
        ?.let { runCatching { ProtocolJson.decodeFromString<Map<String, TitlePlaybackChoices>>(it) }.getOrNull() }
        ?.let(::LinkedHashMap)
        ?: LinkedHashMap()

    private fun key(identity: PlaybackIdentity) = "${identity.profileId}:${identity.mediaId}"

    private companion object {
        const val StorageKey = "title-playback.v1"
        const val TitleLimit = 500
    }
}
