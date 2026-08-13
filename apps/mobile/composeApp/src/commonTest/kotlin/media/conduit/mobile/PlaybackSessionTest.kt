package media.conduit.mobile

import kotlinx.coroutines.test.TestScope
import kotlin.test.Test
import kotlin.test.assertEquals

class PlaybackSessionTest {
    @Test
    fun presentationTransitionsKeepClosedSessionsClosed() {
        PlaybackPresentationCommand.entries
            .filterNot { it == PlaybackPresentationCommand.Close }
            .forEach { command ->
                assertEquals(
                    PlaybackPresentation.Closed,
                    transitionPlaybackPresentation(PlaybackPresentation.Closed, command),
                )
            }
    }

    @Test
    fun systemPipReturnsToFullScreen() {
        val pip = transitionPlaybackPresentation(
            PlaybackPresentation.FullScreen,
            PlaybackPresentationCommand.EnterSystemPip,
        )
        assertEquals(PlaybackPresentation.SystemPip, pip)
        assertEquals(
            PlaybackPresentation.FullScreen,
            transitionPlaybackPresentation(pip, PlaybackPresentationCommand.ExitSystemPip),
        )
    }

    @Test
    fun closeWinsFromEveryPresentation() {
        PlaybackPresentation.entries.forEach { presentation ->
            assertEquals(
                PlaybackPresentation.Closed,
                transitionPlaybackPresentation(presentation, PlaybackPresentationCommand.Close),
            )
        }
    }

    @Test
    fun pictureInPictureAspectRatioIsClampedToPlatformRange() {
        assertEquals(16 to 9, clampPipAspectRatio(16, 9))
        assertEquals(239 to 100, clampPipAspectRatio(32, 9))
        assertEquals(100 to 239, clampPipAspectRatio(9, 32))
        assertEquals(1 to 1, clampPipAspectRatio(0, 0))
    }

    @Test
    fun refreshingTheSameRequestDoesNotRestoreAMinimizedPlayer() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "media", "episode"),
            url = "https://example.test/video.m3u8",
            title = "Episode",
            mediaName = "Series · Episode",
        )
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            playNext = {},
            openEpisodes = {},
            minimized = {},
            closed = {},
        )

        controller.start(request, callbacks)
        controller.minimize()
        controller.start(request.copy(subtitles = emptyList()), callbacks)

        assertEquals(PlaybackPresentation.Mini, controller.state.presentation)
        assertEquals(request.url, controller.state.request?.url)
    }

    @Test
    fun restoringMiniPlayerKeepsTheLivePlaybackState() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "movie", "media", "video"),
            url = "https://example.test/video.m3u8",
            title = "Movie",
            mediaName = "Movie",
        )
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            playNext = {},
            openEpisodes = {},
            minimized = {},
            closed = {},
        )
        val playback = PlaybackState(playing = true, positionMs = 42_000, durationMs = 120_000)

        controller.start(request, callbacks)
        controller.updatePlayback(playback)
        controller.minimize()
        controller.restore()

        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertEquals(request, controller.state.request)
        assertEquals(playback, controller.state.playback)
    }
}
