package media.conduit.mobile.account

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DiagnosticLogStoreTest {
    @Test
    fun persistedEntryValuesRedactHeadersAndJsonCredentials() {
        DiagnosticLogStore.clear()
        DiagnosticLogStore.info("network", "Authorization: Bearer top-secret\nCookie: session=private\n" +
            "{\"access_token\":\"credential\", \"password\":\"two words\"}")
        val message = DiagnosticLogStore.entries.value.single().message
        listOf("top-secret", "session=private", "credential", "two words").forEach {
            assertFalse(it in message)
        }
    }

    @Test
    fun concurrentNativeAndAppEventsDoNotOverwriteEachOther() = runTest {
        DiagnosticLogStore.clear()
        (0..7).map { worker ->
            async(Dispatchers.Default) {
                repeat(20) { DiagnosticLogStore.info("thread", "worker=$worker event=$it") }
            }
        }.awaitAll()
        assertEquals(160, DiagnosticLogStore.entries.value.size)
        assertEquals(160, DiagnosticLogStore.entries.value.map { it.message }.toSet().size)
    }

    @Test
    fun debugEntriesRequireVerboseLoggingButErrorsAlwaysRemainVisible() {
        DiagnosticLogStore.clear()
        DiagnosticLogStore.setDebugLoggingEnabled(false)

        DiagnosticLogStore.debug("playback/state", "hidden")
        DiagnosticLogStore.error("ios/mpv", "visible")

        assertEquals(1, DiagnosticLogStore.entries.value.size)
        assertEquals(DiagnosticLevel.Error, DiagnosticLogStore.entries.value.single().level)

        DiagnosticLogStore.setDebugLoggingEnabled(true)
        DiagnosticLogStore.debug("playback/state", "visible")
        assertEquals(2, DiagnosticLogStore.entries.value.size)
    }

    @Test
    fun nativeEventsAreParsedAndTheBufferIsBounded() {
        DiagnosticLogStore.clear()
        DiagnosticLogStore.setDebugLoggingEnabled(true)

        DiagnosticLogStore.recordNativeEvent("warn\tios/mpv\tstream stalled\n")
        repeat(DiagnosticLogStore.maxEntries + 5) {
            DiagnosticLogStore.info("test", "line=$it")
        }

        assertTrue(DiagnosticLogStore.entries.value.size <= DiagnosticLogStore.maxEntries)
        assertFalse(DiagnosticLogStore.entries.value.any { it.category == "ios/mpv" && it.level == DiagnosticLevel.Warn })
        assertTrue(DiagnosticLogStore.entries.value.first().message != "line=0")
        assertEquals("line=${DiagnosticLogStore.maxEntries + 4}", DiagnosticLogStore.entries.value.last().message)
    }

    @Test
    fun copiedEntriesRedactUrlsAndSecrets() {
        DiagnosticLogStore.clear()
        DiagnosticLogStore.setDebugLoggingEnabled(false)

        DiagnosticLogStore.info("network", "GET https://example.test/stream.m3u8?token=abc token=secret")

        val copied = DiagnosticLogStore.copyText()
        assertTrue("https://" !in copied)
        assertTrue("token=secret" !in copied)
        assertTrue("[url]" in copied)
    }
}
