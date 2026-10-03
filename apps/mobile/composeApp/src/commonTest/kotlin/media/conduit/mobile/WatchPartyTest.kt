package media.conduit.mobile

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class WatchPartyTest {
    private val timeline = PartyTimeline(20.0, 100.0, true, 1.5, 2, 1000, "epoch", 1)

    @Test
    fun projectsWithMonotonicElapsedTimeAndStopsAtTheEnd() {
        assertEquals(23.0, partyPosition(timeline, 20.0, 2000))
        assertEquals(100.0, partyPosition(timeline, 99.0, 2000))
        assertEquals(20.0, partyPosition(timeline.copy(playing = false), 20.0, 2000))
        assertFalse(validPartyTimeline(timeline.copy(position = Double.NaN)))
        assertFalse(validPartyTimeline(timeline.copy(rate = 0.0)))
    }

    @Test
    fun rejectsInvitationsForAnotherServer() {
        val token = "a".repeat(43)
        assertEquals(token, watchPartyInviteToken("https://conduit.test/party/$token", "https://conduit.test"))
        assertEquals(token, watchPartyInviteToken("conduit://party/$token?server=https%3A%2F%2Fconduit.test", "https://conduit.test"))
        assertFailsWith<IllegalArgumentException> { watchPartyInviteToken("https://other.test/party/$token", "https://conduit.test") }
        assertFailsWith<IllegalArgumentException> { watchPartyInviteToken("conduit://party/$token?server=https%3A%2F%2Fother.test", "https://conduit.test") }
    }

    @Test
    fun guestCommandsCannotReplaceTheHostTimeline() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(PlaybackRequest(identity = PlaybackIdentity("profile", "movie", "movie", "movie"), url = "https://example.test/video.mp4", title = "Movie", mediaName = "Movie"), PlaybackSessionCallbacks(persist = { _, _ -> }, playNext = {}, openEpisodes = {}, minimized = {}, closed = {}))
        controller.partyGuest = true
        controller.send(PlaybackCommand.Play)
        controller.send(PlaybackCommand.SeekTo(90_000))
        assertNull(controller.state.command)
        controller.sendPartyState(75_000, 1.5f, false)
        assertEquals(PlaybackCommand.PartyState(75_000, 1.5f, false), controller.state.command?.command)
    }
}
