package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.foundation.DevicePreferences
import media.conduit.mobile.foundation.MemorySettingsStore

class TitlePlaybackTest {
    private val episodeOne = PlaybackIdentity("profile", "series", "tt1", "tt1:1:1")
    private val episodeTwo = episodeOne.copy(videoId = "tt1:1:2")

    @Test
    fun choicesFollowTheTitleAcrossEpisodesButNotProfiles() {
        val repository = TitlePlaybackRepository(MemorySettingsStore())
        repository.remember(episodeOne, audioChoice("jpn", "Japanese 5.1"))
        repository.remember(episodeOne, subtitleChoice(true, null, "English (SDH)"))

        assertEquals(TitlePlaybackChoices("ja", "en"), repository.load(episodeTwo))
        assertEquals(TitlePlaybackChoices(), repository.load(episodeOne.copy(profileId = "other")))
    }

    @Test
    fun unknownLanguagesKeepThePreviousChoice() {
        val repository = TitlePlaybackRepository(MemorySettingsStore())
        repository.remember(episodeOne, subtitleChoice(false, null, null))
        repository.remember(episodeOne, subtitleChoice(true, "und", "Signs"))

        assertEquals(SubtitlesOff, repository.load(episodeOne).subtitleLanguage)
    }

    @Test
    fun rememberedLanguagesGoAheadOfGlobalPreferences() {
        val preferences = DevicePreferences(preferredAudioLanguage = "en", preferredSubtitleLanguage = "en", secondarySubtitleLanguage = "fr")

        assertEquals(PlaybackLanguagePreferences("en", "en", "fr", false), preferences.languagesFor(TitlePlaybackChoices()))
        assertEquals(PlaybackLanguagePreferences("ja", "es", "en", false), preferences.languagesFor(TitlePlaybackChoices("ja", "es")))
        assertEquals(PlaybackLanguagePreferences("en", SubtitlesOff, null, false), preferences.languagesFor(TitlePlaybackChoices(subtitleLanguage = SubtitlesOff)))
    }

    @Test
    fun aRememberedSubtitlePickOverridesForcedOnlyMode() {
        val preferences = DevicePreferences(forcedSubtitlesOnly = true)

        assertEquals(true, preferences.languagesFor(TitlePlaybackChoices()).forcedSubtitlesOnly)
        assertEquals(false, preferences.languagesFor(TitlePlaybackChoices(subtitleLanguage = "en")).forcedSubtitlesOnly)
    }

    @Test
    fun theDelayIsRememberedAndStepsInTenthsWithinThirtySeconds() {
        val repository = TitlePlaybackRepository(MemorySettingsStore())
        repository.remember(episodeOne, TitlePlaybackChoices(subtitleDelayMs = 1_300))
        repository.remember(episodeOne, audioChoice("jpn", null))

        assertEquals(1_300, repository.load(episodeTwo).subtitleDelayMs)
        assertEquals(900, stepSubtitleDelay(-100, 1_000))
        assertEquals(30_000, stepSubtitleDelay(29_500, 1_000))
        assertEquals(listOf("+0.3s", "−1.2s", "0.0s"), listOf(300L, -1_200L, 0L).map(::formatSubtitleDelay))
        assertEquals(listOf(1, 1, 5), listOf(0L, 1_400L, 1_600L).map(::heldSubtitleDelaySteps))
    }

    @Test
    fun syncByEarShiftsTheDelayByTheGapBetweenHearingAndSeeing() {
        // Subtitle shown 1.2 s after the line is heard: show subtitles earlier.
        assertEquals(-1_200, syncByEarDelay(0, 10_000, 11_230))
        // Subtitle shown before the line, on top of an existing delay.
        assertEquals(300, syncByEarDelay(-500, 20_800, 20_000))
        assertEquals(30_000, syncByEarDelay(29_000, 5_000, 1_000))
    }

    @Test
    fun forcedOnlyModeSkipsFullSubtitles() {
        val full = SubtitleCandidate("full", "en", embedded = true)
        val signs = SubtitleCandidate("signs", "en", "Signs & Songs", embedded = false)
        val flagged = SubtitleCandidate("flagged", "en", embedded = true, forced = true)
        fun decide(vararg candidates: SubtitleCandidate<String>) =
            preferredSubtitle(candidates.toList(), "en", null, "en", embeddedReady = true, addonsReady = true, forcedOnly = true)

        assertEquals(SubtitleDecision.Select("flagged"), decide(full, signs, flagged))
        assertEquals(SubtitleDecision.Select("signs"), decide(full, signs))
        assertEquals(SubtitleDecision.Off, decide(full, SubtitleCandidate("plain", "en", "No signs", embedded = true)))
    }

    @Test
    fun subtitlesOffSelectsNoTrack() {
        val candidates = listOf(SubtitleCandidate("english", "en", embedded = true))

        assertEquals(
            SubtitleDecision.Off,
            preferredSubtitle(candidates, SubtitlesOff, null, "en", embeddedReady = true, addonsReady = true),
        )
    }
}
