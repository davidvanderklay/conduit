package media.conduit.mobile

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import media.conduit.mobile.account.VideoItem
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class StreamPickerLifecycleTest {
    @Test
    fun closingSourcesCancelsTheRetainedLookup() = runTest {
        val controller = PlaybackSessionController(this)
        var cancelled = false
        controller.launchStreamLookup {
            try {
                awaitCancellation()
            } finally {
                cancelled = true
            }
        }.start()
        runCurrent()

        controller.closeStreamPicker()
        runCurrent()

        assertTrue(cancelled)
    }

    @Test
    fun retainedPlayerSourcesSettleAfterTheDetailsScreenCloses() = runTest {
        val detailsScope = CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler))
        val controller = PlaybackSessionController(this)
        val picker = PlaybackStreamPickerState(episode = VideoItem("show:1:1", title = "Episode 1"), loading = true)
        controller.start(
            PlaybackRequest(
                identity = PlaybackIdentity("profile", "series", "show", "show:1:1"),
                url = "https://example.test/episode.mkv",
                title = "Episode 1",
                mediaName = "Show",
            ),
            PlaybackSessionCallbacks(
                persist = { _, _ -> }, playNext = {}, openEpisodes = {}, minimized = {}, closed = {},
                openSources = {
                    controller.showStreamPicker(picker)
                    val job = controller.launchStreamLookup {
                        val result = loadStreamsWithRetry(load = { emptyList() })
                        controller.updateStreamPicker(picker.copy(loading = false, streams = result.getOrThrow()))
                    }
                    job.start()
                },
            ),
        )
        controller.minimize()
        detailsScope.cancel()
        controller.restore()
        controller.openSources()
        advanceUntilIdle()

        assertFalse(assertNotNull(controller.state.streamPicker).loading)
    }
}
