package media.conduit.mobile

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackHandoffTest {
    private val old = PlaybackRequest(
        identity = PlaybackIdentity("profile", "series", "invincible", "episode-1"),
        url = "https://example.test/old.mp4",
        title = "Invincible", mediaName = "Invincible",
    )
    private val replacement = old.copy(
        identity = old.identity.copy(mediaId = "monk", videoId = "episode-16"),
        url = "https://example.test/monk.mp4",
        title = "Monk", mediaName = "Monk",
    )
    private fun callbacks(persist: suspend (PlaybackRequest, PlaybackState) -> Unit = { _, _ -> }) =
        PlaybackSessionCallbacks(
            persist = persist, playNext = {}, openEpisodes = {}, minimized = {}, closed = {},
        )

    @Test
    fun replacementStaysCoveredUntilItsPlaybackIsReady() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(old, callbacks())
        controller.updatePlayback(PlaybackState(loading = false, playing = true, videoWidth = 1920, videoHeight = 1080))
        controller.minimize()
        controller.beginTransition("Monk", "Monk", null)
        val previousSession = controller.state.sessionId
        controller.start(replacement, callbacks())

        assertNotNull(controller.state.transition, "The old drawable must stay covered during the native URL handoff")
        controller.start(replacement.copy(title = "Monk episode 16"), callbacks())
        assertNotNull(controller.state.transition, "A metadata refresh must not reveal an unfinished load")
        controller.updatePlayback(previousSession, old.streamKeyForPlayback(), PlaybackState(loading = false, playing = true, videoWidth = 1920, videoHeight = 1080))
        assertNotNull(controller.state.transition)
        controller.updatePlayback(controller.state.sessionId, replacement.streamKeyForPlayback(), PlaybackState())
        assertNotNull(controller.state.transition)
        controller.updatePlayback(controller.state.sessionId, replacement.streamKeyForPlayback(), PlaybackState(loading = false, playing = true, videoWidth = 1920, videoHeight = 1080))
        assertNull(controller.state.transition)
    }

    @Test
    fun playbackIntentPausesAndCheckpointsTheMiniPlayerBeforeResolving() = runTest {
        val saved = mutableListOf<Pair<PlaybackRequest, PlaybackState>>()
        val controller = PlaybackSessionController(this)
        controller.start(old, callbacks { request, playback -> saved += request to playback })
        controller.updatePlayback(PlaybackState(loading = false, playing = true, positionMs = 42_000, durationMs = 100_000))
        controller.minimize()
        advanceUntilIdle()
        saved.clear()

        val attempt = controller.beginPlaybackIntent(replacement.identity, replacement.title, null)

        assertNotNull(attempt)
        assertEquals(PlaybackCommand.Pause, controller.state.command?.command)
        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertEquals(replacement.identity, controller.state.transition?.identity)
        assertEquals(old, controller.state.request)
        // Readiness for the old file cannot complete the source-resolution stage.
        controller.updatePlayback(controller.state.sessionId, old.streamKeyForPlayback(), PlaybackState(loading = false, videoWidth = 1920, videoHeight = 1080))
        assertNotNull(controller.state.transition)
        advanceUntilIdle()
        assertEquals(old.identity, saved.single().first.identity)
        assertEquals(42_000, saved.single().second.positionMs)
    }

    @Test
    fun newerPlaybackIntentRejectsLateResolutionAndReadiness() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(old, callbacks())
        val monkAttempt = controller.beginPlaybackIntent(replacement.identity, "Monk", null)
        val third = replacement.copy(identity = replacement.identity.copy(mediaId = "third", videoId = "third"), url = "https://example.test/third.mp4")
        val thirdAttempt = controller.beginPlaybackIntent(third.identity, "Third", null)

        assertFalse(controller.isCurrentAttempt(monkAttempt))
        controller.start(replacement, callbacks(), monkAttempt)
        assertEquals(old, controller.state.request)
        assertEquals(third.identity, controller.state.transition?.identity)
        controller.start(third, callbacks(), thirdAttempt)
        controller.updatePlayback("playback-1", old.streamKeyForPlayback(), PlaybackState(loading = false, videoWidth = 1920, videoHeight = 1080))
        assertEquals(third, controller.state.request)
        assertNotNull(controller.state.transition)
    }

    @Test
    fun cancellingReplacementRejectsLateSourcesAndNativeCallbacks() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(old, callbacks())
        val attempt = controller.beginPlaybackIntent(replacement.identity, "Monk", null)
        val oldSession = controller.state.sessionId
        controller.close()
        controller.start(replacement, callbacks(), attempt)
        controller.updatePlayback(oldSession, old.streamKeyForPlayback(), PlaybackState(loading = false, videoWidth = 1920, videoHeight = 1080))
        assertNull(controller.state.request)
        assertNull(controller.state.transition)
        assertEquals(PlaybackPresentation.Closed, controller.state.presentation)
    }

    @Test
    fun aNewTitleUsesItsOwnProgressWhileASourceSwitchKeepsTheLivePosition() {
        val session = PlaybackSessionState(
            request = old,
            playback = PlaybackState(positionMs = 42_000, durationMs = 100_000),
        )
        assertEquals(7_000, sourceSwitchStartPosition(session, replacement.identity, 7_000))
        assertEquals(42_000, sourceSwitchStartPosition(session, old.identity, 7_000))
        assertEquals(7_000, sourceSwitchStartPosition(session, old.identity.copy(profileId = "other-profile"), 7_000))
    }

    @Test
    fun owningAutomaticEntryCanResolveItsPendingIntent() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(old, callbacks())
        val attempt = controller.beginPlaybackIntent(replacement.identity, "Monk", null)
        assertTrue(shouldRunAutomaticStreamResolution(MediaOpenMode.AutoResume, true, true, transitionOwnedByTarget = true))
        assertFalse(shouldRunAutomaticStreamResolution(MediaOpenMode.AutoResume, true, true))
        // Source resolution reuses the owning attempt, rather than replacing it.
        assertEquals(attempt, controller.beginTransition("Monk episode 16", "Monk", null, identity = replacement.identity))
        controller.resolving(attempt)
        assertEquals(true, controller.state.transition?.resolutionStarted)
        controller.start(replacement, callbacks(), attempt)
        controller.updatePlayback(controller.state.sessionId, replacement.streamKeyForPlayback(), PlaybackState(loading = false, error = "No video output"))
        assertNotNull(controller.state.transition)
    }


    @Test
    fun oldPipEventsCannotReopenTheMiniPlayerDuringReplacement() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(old, callbacks())
        controller.systemPipChanged(true)
        controller.beginPlaybackIntent(replacement.identity, "Monk", null)
        controller.systemPipChanged(true)
        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertNotNull(controller.state.transition)
    }

}
