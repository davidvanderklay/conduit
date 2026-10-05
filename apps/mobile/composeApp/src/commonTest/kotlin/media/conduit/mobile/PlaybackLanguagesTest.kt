package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlaybackLanguagesTest {
    @Test
    fun pickerOffersTheSharedLanguageListAfterSystemDefault() {
        assertEquals("auto" to "System default", languagePreferenceOptions.first())
        assertTrue(languagePreferenceOptions.containsAll(listOf("en" to "English", "sv" to "Swedish", "th" to "Thai")))
        assertEquals("Swedish", languagePreferenceLabel("sv"))
    }

    @Test
    fun tracksMatchAPreferenceThroughCodesAliasesAndLabels() {
        assertEquals("sv", trackLanguageCode("swe"))
        assertEquals("el", trackLanguageCode("gre", "Embedded"))
        assertEquals("pt", trackLanguageCode(null, "Brazilian Portuguese (SDH)"))
        assertEquals(null, trackLanguageCode("und", "Signs"))
        assertTrue(sameLanguage("sv-SE", "swe"))
        assertFalse(sameLanguage(null, null))
    }

    @Test
    fun systemDefaultFollowsTheDeviceLanguage() {
        assertEquals("he", preferredLanguageCode("auto", "iw"))
        assertEquals("ko", preferredLanguageCode("ko", "en"))
    }
}
