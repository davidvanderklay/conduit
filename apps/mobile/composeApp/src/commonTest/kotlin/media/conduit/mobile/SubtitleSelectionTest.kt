package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals

class SubtitleSelectionTest {
    private fun embedded(id: String, language: String) = SubtitleCandidate(id, language, embedded = true)
    private fun addon(id: String, language: String) = SubtitleCandidate(id, language, embedded = false)
    private fun select(candidates: List<SubtitleCandidate<String>>, ready: Boolean = true, secondary: String? = "Spanish") =
        preferredSubtitle(candidates, "English", secondary, "en-US", embeddedReady = true, addonsReady = ready)

    @Test fun primaryEmbeddedWinsBeforeAddonLookupFinishes() {
        assertEquals(SubtitleDecision.Select("en"), select(listOf(addon("en-addon", "eng"), embedded("es", "es"), embedded("en", "en-US")), false))
    }
    @Test fun delayedPrimaryAddonBeatsSecondaryEmbedded() {
        assertEquals(SubtitleDecision.Wait, select(listOf(embedded("es", "spa")), false))
        assertEquals(SubtitleDecision.Select("en"), select(listOf(embedded("es", "spa"), addon("en", "eng"))))
    }
    @Test fun secondaryPrefersEmbedded() {
        assertEquals(SubtitleDecision.Select("es"), select(listOf(addon("es-addon", "spa"), embedded("es", "es-MX"))))
    }
    @Test fun secondaryAddonCanBeSelected() {
        assertEquals(SubtitleDecision.Select("es"), select(listOf(addon("es", "spa"))))
    }
    @Test fun missingLanguagesAndDisabledFallbackTurnSubtitlesOff() {
        assertEquals(SubtitleDecision.Off, select(listOf(embedded("ja", "ja"))))
        assertEquals(SubtitleDecision.Off, select(listOf(embedded("es", "es")), secondary = null))
        assertEquals(SubtitleDecision.Off, select(emptyList()))
    }
    @Test fun embeddedDiscoveryMustCompleteFirst() {
        assertEquals(SubtitleDecision.Wait, preferredSubtitle(listOf(addon("en", "eng")), "English", "Spanish", "en", false, true))
    }
    @Test fun systemLanguageAndTitlesMatchAliases() {
        assertEquals(SubtitleDecision.Select("es"), preferredSubtitle(listOf(embedded("es", "spa")), "System default", "Spanish", "es-MX", true, false))
        assertEquals(SubtitleDecision.Select("en"), select(listOf(SubtitleCandidate("en", null, "English SDH", true))))
    }
    @Test fun expandedLanguageAliasesAndSystemPreferenceUseSharedMatcher() {
        assertEquals(SubtitleDecision.Select("pl"), preferredSubtitle(listOf(embedded("pl", "pol")), "auto", null, "pl-PL", true, false))
        assertEquals(SubtitleDecision.Select("nl"), preferredSubtitle(listOf(embedded("nl", "dut")), "en", "nl", "en", true, true))
    }

}
