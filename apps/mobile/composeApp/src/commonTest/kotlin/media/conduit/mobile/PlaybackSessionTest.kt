package media.conduit.mobile

import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import media.conduit.mobile.account.StreamItem
import media.conduit.mobile.account.StreamSource
import media.conduit.mobile.account.VideoItem

class PlaybackSessionTest {
    @Test
    fun liveQueueAddsNextToAnActiveMovieWithoutRestartingIt() = runTest {
        val identity = PlaybackIdentity("profile", "movie", "movie", "movie")
        val request = PlaybackRequest(
            identity = identity,
            url = "https://example.test/movie.mp4",
            title = "Movie",
            mediaName = "Movie",
        )
        val queued = media.conduit.mobile.account.PlaybackQueueItem(
            "series", "show", "s1e1", "Show", videoTitle = "Episode 1", season = 1, episode = 1,
        )
        var selected: media.conduit.mobile.account.PlaybackQueueItem? = null
        val controller = PlaybackSessionController(this)
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                playQueueItem = { selected = it },
                minimized = {},
                closed = {},
            ),
        )
        val sessionId = controller.state.sessionId

        val upNext = playbackUpNext(request, listOf(queued))
        assertNotNull(upNext)
        controller.updateQueuedNext(identity, upNext.queuedItem)
        controller.playNext()

        assertTrue(upNext.nextItemQueued)
        assertEquals("S1E1", upNext.episodeLabel)
        assertEquals("Show · Episode 1", upNext.nextEpisodeTitle)
        assertEquals(queued, selected)
        assertEquals(sessionId, controller.state.sessionId)
    }

    @Test
    fun queuedNextBeginsTheSameInPlayerTransitionAsSeriesNext() = runTest {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
            url = "https://example.test/current.mp4",
            title = "Episode 1",
            mediaName = "Show",
        )
        val queued = media.conduit.mobile.account.PlaybackQueueItem(
            mediaType = "series",
            mediaId = "other-show",
            videoId = "s2e3",
            name = "Other Show",
            artwork = "https://example.test/other.jpg",
            videoTitle = "The Return",
            season = 2,
            episode = 3,
        )
        var selected: media.conduit.mobile.account.PlaybackQueueItem? = null
        val controller = PlaybackSessionController(this)
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                playQueueItem = { selected = it },
                minimized = {},
                closed = {},
            ),
        )

        controller.playQueueItem(queued)

        assertEquals(queued, selected)
        assertEquals("The Return - (2x3)", controller.state.transition?.title)
        assertEquals("Other Show", controller.state.transition?.mediaName)
        assertEquals("https://example.test/other.jpg", controller.state.transition?.artwork)
        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
    }

    @Test
    fun upNextSeparatesEpisodeMetadataFromTheTitle() {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e2"),
            url = "https://example.test/episode.mp4",
            title = "Episode 2",
            mediaName = "Show",
            hasNextEpisode = true,
            nextEpisodeTitle = "S1E3 · The Extraordinary Machines We Built Together",
        )

        val upNext = assertNotNull(playbackUpNext(request, emptyList()))

        assertEquals("S1E3", upNext.episodeLabel)
        assertEquals("The Extraordinary Machines We Built Together", upNext.nextEpisodeTitle)
    }

    @Test
    fun nextTransitionImmediatelyReplacesTheVisibleOpeningMetadata() = runTest {
        val controller = PlaybackSessionController(this)
        controller.start(
            PlaybackRequest(
                identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
                url = "https://example.test/one.mp4",
                title = "Episode 1",
                mediaName = "Show",
            ),
            PlaybackSessionCallbacks(
                persist = { _, _ -> }, playNext = {}, openEpisodes = {}, minimized = {}, closed = {},
            ),
        )

        controller.beginTransition("Episode 2", "Show", "https://example.test/two.jpg")

        assertEquals("Episode 2", controller.state.transition?.title)
        assertEquals("https://example.test/two.jpg", controller.state.transition?.artwork)
        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertEquals(PlaybackCommand.Pause, controller.state.command?.command)
    }

    @Test
    fun nextTransitionIgnoresRepeatedNextPresses() = runTest {
        lateinit var controller: PlaybackSessionController
        var advanceRequests = 0
        controller = PlaybackSessionController(this)
        controller.start(
            PlaybackRequest(
                identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
                url = "https://example.test/one.mp4",
                title = "Episode 1",
                mediaName = "Show",
            ),
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {
                    advanceRequests += 1
                    controller.beginTransition("Episode 2", "Show", null)
                },
                openEpisodes = {},
                minimized = {},
                closed = {},
            ),
        )

        controller.playNext()
        controller.playNext()

        assertEquals(1, advanceRequests)
        assertEquals("Episode 2", controller.state.transition?.title)
    }

    @Test
    fun restartingTheSameStreamClearsThePendingTransition() = runTest {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
            url = "https://example.test/one.mp4",
            title = "Episode 1",
            mediaName = "Show",
        )
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> }, playNext = {}, openEpisodes = {}, minimized = {}, closed = {},
        )
        val controller = PlaybackSessionController(this)
        controller.start(request, callbacks)
        controller.beginTransition("Episode 2", "Show", "https://example.test/background.jpg")

        controller.start(request, callbacks)

        assertEquals(null, controller.state.transition)
    }

    @Test
    fun transitionSourcePickerKeepsTheHorizontalPlayerVisible() = runTest {
        val controller = PlaybackSessionController(this)
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
            url = "https://example.test/one.mp4",
            title = "Episode 1",
            mediaName = "Show",
        )
        val picker = PlaybackStreamPickerState(
            episode = VideoItem(
                id = "s1e2",
                title = "Episode 2",
                season = 1,
                episode = 2,
            ),
            resumeFrom = "Start from beginning",
        )

        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                minimized = {},
                closed = {},
            ),
        )
        controller.beginTransition("Episode 2", "Show", null)
        controller.showStreamPicker(picker)

        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertEquals(picker, controller.state.streamPicker)
        assertEquals("Episode 2", controller.state.transition?.title)
    }

    @Test
    fun prefetchIsSuppressedWhileATransitionIsUnderway() = runTest {
        var prefetchRequests = 0
        val controller = PlaybackSessionController(this)
        controller.start(
            PlaybackRequest(
                identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
                url = "https://example.test/one.mp4",
                title = "Episode 1",
                mediaName = "Show",
            ),
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                prefetchUpNext = { prefetchRequests += 1 },
                openEpisodes = {},
                minimized = {},
                closed = {},
            ),
        )

        controller.prefetchUpNext()
        controller.beginTransition("Episode 2", "Show", null)
        controller.prefetchUpNext()

        assertEquals(1, prefetchRequests)
    }

    @Test
    fun subtitlesCanArriveWithoutRestartingThePlaybackSession() = runTest {
        val identity = PlaybackIdentity("profile", "series", "show", "s1e1")
        val request = PlaybackRequest(
            identity = identity,
            url = "https://example.test/episode.mp4",
            title = "Episode 1",
            mediaName = "Show",
        )
        val controller = PlaybackSessionController(this)
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                minimized = {},
                closed = {},
            ),
        )
        val sessionId = controller.state.sessionId
        val subtitle = media.conduit.mobile.account.SubtitleItem(
            id = "english",
            url = "https://example.test/english.vtt",
            lang = "en",
        )

        controller.updateSubtitles(identity, listOf(subtitle))

        assertEquals(sessionId, controller.state.sessionId)
        assertEquals(listOf(subtitle), controller.state.request?.subtitles)
    }

    @Test
    fun savedStreamStartupAcceptsPlaybackOrFirstFrame() {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e1"),
            url = "https://example.com/episode.mp4",
            title = "Episode 1",
            mediaName = "Show",
            startPositionMs = 30_000,
            autoRecoveryAttempt = true,
        )

        assertTrue(savedStreamStartupStalled(request, PlaybackState(positionMs = 30_000)))
        assertFalse(savedStreamStartupStalled(request, PlaybackState(positionMs = 30_001)))
        assertFalse(
            savedStreamStartupStalled(
                request,
                PlaybackState(positionMs = 30_000, videoWidth = 1920, videoHeight = 1080),
            ),
        )
        assertFalse(savedStreamStartupStalled(request.copy(autoRecoveryAttempt = false), PlaybackState()))
    }

    @Test
    fun playbackReadinessRequiresTheSelectedStreamUrl() {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e2"),
            url = "https://example.com/old.mp4",
            title = "Episode 2",
            mediaName = "Show",
        )

        assertTrue(
            playbackRequestMatchesStream(request, "show", "s1e2", "https://example.com/old.mp4"),
        )
        assertFalse(
            playbackRequestMatchesStream(request, "show", "s1e2", "https://example.com/new.mp4"),
        )
        assertFalse(
            playbackRequestMatchesStream(request, "show", "s1e1", "https://example.com/old.mp4"),
        )
    }

    @Test
    fun recoverableStartupErrorKeepsTheLoadingSurfaceVisible() {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e2"),
            url = "https://example.com/episode.mp4",
            title = "Episode 2",
            mediaName = "Show",
            autoRecoveryAttempt = true,
        )

        assertFalse(
            shouldPresentPlaybackError(
                request,
                PlaybackState(error = "KSPlayer failed to open the stream"),
            ),
        )
        assertTrue(
            shouldPresentPlaybackError(
                request,
                PlaybackState(error = "KSPlayer failed to open the stream"),
                autoRecoveryExhausted = true,
            ),
        )
    }

    @Test
    fun recoveryExhaustionDoesNotCloseTheFullscreenSession() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "s1e2"),
            url = "https://example.com/episode.mp4",
            title = "Episode 2",
            mediaName = "Show",
            autoRecoveryAttempt = true,
        )
        controller.start(
            request,
            PlaybackSessionCallbacks(
                persist = { _, _ -> },
                playNext = {},
                openEpisodes = {},
                minimized = {},
                closed = {},
            ),
        )

        controller.exhaustAutoRecovery(controller.state.sessionId, "All sources failed")

        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
        assertTrue(controller.state.autoRecoveryExhausted)
        assertEquals("All sources failed", controller.state.recoveryError)
    }

    @Test
    fun manualSourceSwitchFailureStaysBehindTheLoadingSurface() {
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "movie", "movie", "movie"),
            url = "https://example.test/new-source.mp4",
            title = "Movie",
            mediaName = "Movie",
            manualSourceSwitch = true,
        )
        val playback = PlaybackState(error = "Source failed")

        assertTrue(manualSourceSwitchStartupStalled(request, playback))
        assertFalse(shouldPresentPlaybackError(request, playback))
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
    fun intentionalReloadOfTheSameSourceStartsFreshPlayback() {
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

        controller.start(request, callbacks)
        controller.updatePlayback(PlaybackState(playing = true, positionMs = 42_000, durationMs = 120_000))
        val firstSessionId = controller.state.sessionId

        controller.start(request.copy(reloadKey = 1L), callbacks)

        assertNotEquals(firstSessionId, controller.state.sessionId)
        assertEquals(PlaybackState(), controller.state.playback)
    }

    @Test
    fun selectingAStreamImmediatelyShowsItsLoadingTransition() {
        val controller = PlaybackSessionController(TestScope())
        val request = PlaybackRequest(
            identity = PlaybackIdentity("profile", "series", "show", "episode-1"),
            url = "https://example.test/episode-1.m3u8",
            title = "Episode 1",
            mediaName = "Show",
        )
        val callbacks = PlaybackSessionCallbacks(
            persist = { _, _ -> },
            playNext = {},
            openEpisodes = {},
            minimized = {},
            closed = {},
        )
        controller.start(request, callbacks)
        controller.showStreamPicker(
            PlaybackStreamPickerState(
                episode = VideoItem("episode-2", title = "Episode 2"),
                streams = listOf(
                    StreamSource("addon", "Addon", StreamItem(url = "https://example.test/episode-2.m3u8")),
                ),
            ),
        )

        controller.selectStream(
            StreamSource("addon", "Addon", StreamItem(url = "https://example.test/episode-2.m3u8")),
        )

        assertNull(controller.state.streamPicker)
        assertEquals("Episode 2", controller.state.transition?.title)
        assertEquals(PlaybackPresentation.FullScreen, controller.state.presentation)
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
