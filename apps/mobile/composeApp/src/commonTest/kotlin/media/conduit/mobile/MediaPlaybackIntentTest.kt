package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import media.conduit.mobile.account.PlaybackSource

class MediaPlaybackIntentTest {
    private val source = PlaybackSource(
        addonId = "addon-1",
        sourceKey = "url:https://example.com/movie.mp4",
        kind = "url",
    )

    @Test
    fun onlyAutoResumeEntryWithPreferenceAndSourceCanAutoResume() {
        assertTrue(shouldAutoResume(MediaOpenMode.AutoResume, autoSelectSavedStreams = true, source))
        assertFalse(shouldAutoResume(MediaOpenMode.Details, autoSelectSavedStreams = true, source))
        assertFalse(shouldAutoResume(MediaOpenMode.AutoResume, autoSelectSavedStreams = false, source))
        assertFalse(shouldAutoResume(MediaOpenMode.AutoResume, autoSelectSavedStreams = true, null))
    }

    @Test
    fun autoResumeEntryWithoutEligibleSourceOpensStreamSelection() {
        assertTrue(shouldOpenStreamSelectionImmediately(MediaOpenMode.AutoResume, true, null))
        assertTrue(shouldOpenStreamSelectionImmediately(MediaOpenMode.AutoResume, false, source))
        assertFalse(shouldOpenStreamSelectionImmediately(MediaOpenMode.Details, true, source))
    }

    @Test
    fun queuedEpisodesFromTheSameShowGetDifferentDetailsInstances() {
        assertNotEquals(
            MediaDetailsInstanceKey("series", "show", "s1e1", MediaOpenMode.Queue),
            MediaDetailsInstanceKey("series", "show", "s1e2", MediaOpenMode.Queue),
        )
    }
}
