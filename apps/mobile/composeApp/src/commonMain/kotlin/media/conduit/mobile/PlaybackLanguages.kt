package media.conduit.mobile

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Stored language preference that follows the device language. */
const val SystemLanguagePreference = "auto"

data class PlaybackLanguage(val code: String, val name: String)

/** Languages offered by the preferred audio and subtitle pickers, shared with web through conduit-core. */
val playbackLanguages: List<PlaybackLanguage> by lazy {
    coreValue(buildJsonObject { put("type", "playbackLanguages") }).jsonArray.map { language ->
        PlaybackLanguage(
            code = language.jsonObject.getValue("code").jsonPrimitive.content,
            name = language.jsonObject.getValue("name").jsonPrimitive.content,
        )
    }
}

/** Picker options as stored preference value to label, with the system default first. */
val languagePreferenceOptions: List<Pair<String, String>> by lazy {
    listOf(SystemLanguagePreference to "System default") + playbackLanguages.map { it.code to it.name }
}

fun languagePreferenceLabel(preference: String): String =
    languagePreferenceOptions.firstOrNull { it.first == preference }?.second ?: preference

fun languageName(code: String): String? = playbackLanguages.firstOrNull { it.code == code }?.name

/**
 * Canonical code for a preference or a track. Accepts two- and three-letter
 * codes, locale tags, and language names, and falls back to the track label
 * when the language tag says nothing. Also called from the iOS mpv bridge.
 */
fun trackLanguageCode(language: String?, label: String? = null): String? =
    coreValue(buildJsonObject {
        put("type", "languageCode")
        put("language", language)
        put("label", label)
    }).jsonPrimitive.contentOrNull

fun sameLanguage(first: String?, second: String?): Boolean {
    val code = trackLanguageCode(first)
    return code != null && code == trackLanguageCode(second)
}

/** Language a preference asks for; the system default follows [systemLanguage]. */
fun preferredLanguageCode(preference: String, systemLanguage: String?): String? =
    trackLanguageCode(if (preference == SystemLanguagePreference) systemLanguage else preference)

/** Reads a stored preference, converting the display names older versions saved into codes. */
fun storedLanguagePreference(stored: String?, fallback: String): String = when (stored) {
    null -> fallback
    SystemLanguagePreference, "System default" -> SystemLanguagePreference
    else -> trackLanguageCode(stored) ?: fallback
}
