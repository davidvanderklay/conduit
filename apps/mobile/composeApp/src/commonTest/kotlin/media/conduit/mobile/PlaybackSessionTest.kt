package media.conduit.mobile

import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import media.conduit.mobile.account.VideoItem

class PlaybackSessionTest {
    @Test
    fun savedStreamStartupRequiresPlaybackProgress() {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
            url = "https://example.com/episode.mp4",
            title = "Episode 1",
            mediaName = "Show",
            startPositionMs = 30_000,
            autoSelectedSavedSource = true,
        )

        assertTrue(savedStreamStartupStalled(request, PlaybackState(positionMs = 30_000)))
        assertFalse(savedStreamStartupStalled(request, PlaybackState(positionMs = 30_001)))
        assertFalse(savedStreamStartupStalled(request.copy(autoSelectedSavedSource = false), PlaybackState()))
    }

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
    fun leavingFullScreenUsesTheMiniplayerPreference() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "movie", "media", "video"),
            url = "https://example.test/video.mp4",
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

        controller.start(request, callbacks)
        controller.leaveFullScreen(miniplayerOnBack = true)
        assertEquals(PlaybackPresentation.Mini, controller.state.presentation)

        controller.restore()
        controller.leaveFullScreen(miniplayerOnBack = false)
        assertEquals(PlaybackPresentation.Closed, controller.state.presentation)
    }

    @Test
    fun openingEpisodePickerKeepsThePlayerFullScreen() {
        var selectedEpisode: String? = null
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "media", "episode-1"),
            url = "https://example.test/episode-1.m3u8",
            title = "Episode 1",
            mediaName = "Series · Episode 1",
            hasEpisodes = true,
        )
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                minimized = {},
                closed = {},
                selectEpisode = { selectedEpisode = it },
            ),
        )

        controller.openEpisodes()

        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertTrue(controller.state.episodePickerOpen)

        controller.selectEpisode("episode-2")

        assertFalse(controller.state.episodePickerOpen)
        assertEquals("episode-2", selectedEpisode)
    }

    @Test
    fun streamPickerKeepsTheCurrentRequestUntilAStreamIsChosen() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "media", "episode-1"),
            url = "https://example.test/episode-1.m3u8",
            title = "Episode 1",
            mediaName = "Series · Episode 1",
            hasEpisodes = true,
        )
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                minimized = {},
                closed = {},
                selectEpisode = {
                    controller.showStreamPicker(
                        PlaybackStreamPickerState(
                            episode = VideoItem("episode-2", title = "Episode 2"),
                        ),
                    )
                },
            ),
        )

        controller.openEpisodes()
        controller.selectEpisode("episode-2")

        assertFalse(controller.state.episodePickerOpen)
        assertEquals(request, controller.state.request)
        assertEquals("episode-2", controller.state.streamPicker?.episode?.id)
    }

    @Test
    fun pictureInPictureAspectRatioIsClampedToPlatformRange() {
        assertEquals(16 to 9, clampPipAspectRatio(16, 9))
        assertEquals(239 to 100, clampPipAspectRatio(32, 9))
        assertEquals(100 to 239, clampPipAspectRatio(9, 32))
        assertEquals(1 to 1, clampPipAspectRatio(0, 0))
    }

    @Test
    fun miniPlayerUsesVideoAspectRatioWithA16By9Fallback() {
        assertEquals(4f / 3f, playbackAspectRatio(4, 3), 0.001f)
        assertEquals(9f / 16f, playbackAspectRatio(9, 16), 0.001f)
        assertEquals(16f / 9f, playbackAspectRatio(0, 0), 0.001f)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun progressPersistenceCoalescesPendingPositions() = runTest {
        val positions = mutableListOf<Long>()
        val controller = PlaybackSessionController(this)
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "movie", "media", "video"),
            url = "https://example.test/video.mp4",
            title = "Movie",
            mediaName = "Movie",
        )
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, playback -> positions += playback.positionMs },
                playNext = {},
                openEpisodes = {},
                minimized = {},
                closed = {},
            ),
        )

        controller.updatePlayback(PlaybackState(playing = true, positionMs = 15_000, durationMs = 120_000))
        controller.persist()
        controller.updatePlayback(PlaybackState(playing = true, positionMs = 45_000, durationMs = 120_000))
        controller.persist()
        advanceUntilIdle()

        assertEquals(listOf(45_000L), positions)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun switchingStreamsKeepsBothProgressCheckpoints() = runTest {
        val videos = mutableListOf<String>()
        val controller = PlaybackSessionController(this)
        val first = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "episode-1"),
            url = "https://example.test/episode-1.m3u8",
            title = "Episode 1",
            mediaName = "Show · Episode 1",
        )
        val second = first.copy(
            identity = first.identity.copy(videoId = "episode-2"),
            url = "https://example.test/episode-2.m3u8",
            title = "Episode 2",
        )
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            persistCheckpoint = { request, _, _ -> videos += request.identity.videoId },
            playNext = {},
            openEpisodes = {},
            minimized = {},
            closed = {},
        )

        controller.start(first, callbacks)
        controller.updatePlayback(PlaybackState(playing = true, positionMs = 15_000, durationMs = 100_000))
        controller.persist()
        controller.start(second, callbacks)
        controller.updatePlayback(PlaybackState(playing = true, positionMs = 25_000, durationMs = 100_000))
        controller.persist()
        advanceUntilIdle()

        assertEquals(listOf("episode-1", "episode-2"), videos)
    }

    @Test
    fun repeatedNextEpisodeTransitionsReplaceTheCurrentRequest() {
        val controller = PlaybackSessionController(TestScope())
        val requests = (1..3).map { episode ->
            PlaybackRequest(
                identity = PlaybackIdentity("profile", "series", "show", "episode-$episode"),
                url = "https://example.test/episode-$episode.m3u8",
                title = "Episode $episode",
                mediaName = "Show · Episode $episode",
            )
        }
        var currentIndex = 0
        lateinit var callbacks: PlaybackSessionCallbacks
        callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            playNext = {
                requests.getOrNull(currentIndex + 1)?.let { next ->
                    currentIndex += 1
                    controller.close(saveProgress = false)
                    controller.start(next, callbacks)
                }
            },
            openEpisodes = {},
            minimized = {},
            closed = {},
        )

        controller.start(requests.first(), callbacks)
        controller.playNext()
        controller.playNext()

        assertEquals("episode-3", controller.state.request?.identity?.videoId)
        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
    }

    @Test
    fun reopeningTheSameStreamRestoresAMinimizedPlayerWithoutResettingPlayback() {
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
        val playback = PlaybackState(playing = true, positionMs = 42_000, durationMs = 120_000)
        controller.updatePlayback(playback)
        controller.minimize()
        controller.start(request.copy(title = "Updated episode"), callbacks)

        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertEquals(request.url, controller.state.request?.url)
        assertEquals(playback, controller.state.playback)
    }

    @Test
    fun replacingAMinimizedStreamStartsFullScreenWithFreshPlaybackState() {
        val controller = PlaybackSessionController(TestScope())
        val first = PlaybackRequest(
            identity = PlaybackIdentity("profile", "movie", "media", "video"),
            url = "https://example.test/first.mp4",
            title = "Movie",
            mediaName = "Movie",
        )
        val second = first.copy(url = "https://example.test/second.mp4")
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            playNext = {},
            openEpisodes = {},
            minimized = {},
            closed = {},
        )

        controller.start(first, callbacks)
        controller.updatePlayback(PlaybackState(playing = true, positionMs = 42_000, durationMs = 120_000))
        controller.minimize()
        controller.start(second, callbacks)

        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertEquals(second.url, controller.state.request?.url)
        assertEquals(PlaybackState(), controller.state.playback)
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

    @Test
    fun staleNativeCallbacksCannotReplaceTheCurrentStream() {
        val controller = PlaybackSessionController(TestScope())
        val first = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "episode-1"),
            url = "https://example.test/episode-1.m3u8",
            title = "Episode 1",
            mediaName = "Show · Episode 1",
        )
        val second = first.copy(
            identity = first.identity.copy(videoId = "episode-2"),
            url = "https://example.test/episode-2.m3u8",
            title = "Episode 2",
        )
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            playNext = {},
            openEpisodes = {},
            minimized = {},
            closed = {},
        )

        controller.start(first, callbacks)
        val firstSessionId = controller.state.sessionId
        val firstStreamKey = first.streamKeyForPlayback()
        controller.start(second, callbacks)

        controller.updatePlayback(
            firstSessionId,
            firstStreamKey,
            PlaybackState(playing = true, positionMs = 90_000, durationMs = 120_000),
        )

        assertEquals("episode-2", controller.state.request?.identity?.videoId)
        assertEquals(0L, controller.state.playback.positionMs)
    }

    @Test
    fun videoOutputRetryStaysOnTheCurrentPlaybackSession() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "movie", "media", "video"),
            url = "https://example.test/video.mp4",
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

        controller.start(request, callbacks)
        controller.send(PlaybackCommand.RetryVideoOutput)

        assertEquals(request, controller.state.request)
        assertEquals(PlaybackCommand.RetryVideoOutput, controller.state.command?.command)
    }
}
