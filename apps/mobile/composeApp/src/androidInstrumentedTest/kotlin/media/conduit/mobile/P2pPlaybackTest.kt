package media.conduit.mobile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import media.conduit.mobile.account.StreamItem
import media.conduit.mobile.foundation.ConduitTheme
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.URL

/** Exercises the packaged JNI engine against the developer's isolated swarm,
 * then decodes real video with both native Android players. */
@RunWith(AndroidJUnit4::class)
class P2pPlaybackTest {
    @get:Rule val compose = createComposeRule()
    @Volatile private var state = PlaybackState()
    private var command by mutableStateOf<SequencedPlaybackCommand?>(null)

    @Test fun media3StreamsAndSeeks() = exercise(AndroidPlaybackEngine.Media3)
    @Test fun libmpvStreamsAndSeeks() = exercise(AndroidPlaybackEngine.Libmpv)

    private fun exercise(engine: AndroidPlaybackEngine) {
        assumeTrue(p2pCompiled)
        val fixture = InstrumentationRegistry.getArguments().getString("p2pFixture")
        assumeTrue("Provide p2pFixture from packages/p2p/examples/local-swarm", fixture != null)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        initializeP2pPlatform(context)
        val source = Json { ignoreUnknownKeys = true }.decodeFromString<StreamItem>(URL(fixture).readText())
        val environment = AndroidP2pEnvironment(context)
        assertTrue("Emulator must have an unmetered network", environment.transfersAllowed())
        val session = P2pSessionController()
        val preparationStarted = android.os.SystemClock.elapsedRealtime()
        val prepared = runBlocking { session.prepare(source, environment) }
        val preparationMs = android.os.SystemClock.elapsedRealtime() - preparationStarted
        val playbackStarted = android.os.SystemClock.elapsedRealtime()
        try {
            compose.setContent {
                ConduitTheme(amoledBlack = true) {
                    NativePlayer(url = prepared.url, active = true, loadId = prepared.requestId,
                        androidPlaybackEngine = engine, command = command,
                        contentTitle = "Conduit P2P fixture", modifier = Modifier.fillMaxSize(),
                        onState = { state = it })
                }
            }
            compose.waitUntil(45_000) { state.error != null || state.videoWidth > 0 }
            val firstFrameMs = android.os.SystemClock.elapsedRealtime() - playbackStarted
            InstrumentationRegistry.getInstrumentation().sendStatus(0, android.os.Bundle().apply {
                putString("p2pEngine", engine.name)
                putLong("preparationMs", preparationMs)
                putLong("firstFrameMs", firstFrameMs)
                putLong("processPssKiB", android.os.Debug.getPss())
            })
            compose.waitUntil(15_000) { state.error != null || state.positionMs > 1_000 }
            assertNull(state.error)
            assertTrue(state.durationMs > 40_000)
            assertEquals(if (engine == AndroidPlaybackEngine.Media3) NativePlaybackEngine.Media3 else NativePlaybackEngine.Libmpv, state.engine)
            compose.runOnIdle { command = SequencedPlaybackCommand(1, PlaybackCommand.SeekTo(30_000)) }
            compose.waitUntil(30_000) { state.error != null || state.positionMs >= 30_000 }
            assertNull(state.error)
            compose.runOnIdle { command = SequencedPlaybackCommand(2, PlaybackCommand.SeekTo(5_000)) }
            compose.waitUntil(30_000) { state.error != null || state.positionMs in 5_000..15_000 }
            assertNull(state.error)
            compose.runOnIdle { command = SequencedPlaybackCommand(3, PlaybackCommand.Pause) }
            compose.waitUntil(10_000) { !state.playing }
            runBlocking { session.update(paused = true, allowed = true) }
            runBlocking { session.update(paused = false, allowed = true) }
            compose.runOnIdle { command = SequencedPlaybackCommand(4, PlaybackCommand.Play) }
            compose.waitUntil(15_000) { state.playing }
            // Exercise a policy stop while the player still owns a URL. No P2P
            // connection may survive the application's release call.
            runBlocking { session.update(paused = false, allowed = false) }
        } finally {
            compose.runOnIdle { command = SequencedPlaybackCommand(5, PlaybackCommand.Pause) }
            runBlocking { session.release(prepared.requestId) }
        }
        val cache = context.cacheDir.resolve("p2p")
        assertTrue(cache.listFiles().orEmpty().none { it.isDirectory && it.name.startsWith("conduit-p2p-") })
    }

    @Test fun failedStartupReleasesItsNativeHandle() {
        assumeTrue(p2pCompiled)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        initializeP2pPlatform(context)
        val session = P2pSessionController()
        val result = runCatching {
            runBlocking { session.prepare(StreamItem(infoHash = "invalid"), AndroidP2pEnvironment(context)) }
        }
        assertTrue(result.isFailure)
        assertNull(session.activeRequestId)
    }

    @Test fun loadedLibraryMatchesTheBuildAndExcludedStartsFail() {
        assertEquals(p2pCompiled, p2pAvailable)
        if (!p2pCompiled) {
            val client = EngineClient()
            try {
                val result = client.dispatch(EngineAction.StartP2p(requestId = "excluded",
                    source = P2pSource(infoHash = "a".repeat(40)), cacheDirectory = "/invalid/never/create"))
                assertEquals("p2p_unavailable", (result as EngineState.Error).code)
            } finally { client.close() }
        }
    }
}
