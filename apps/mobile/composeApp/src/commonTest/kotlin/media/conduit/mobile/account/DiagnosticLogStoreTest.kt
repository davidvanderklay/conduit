package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DiagnosticLogStoreTest {
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

        assertEquals(DiagnosticLogStore.maxEntries, DiagnosticLogStore.entries.value.size)
        assertFalse(DiagnosticLogStore.entries.value.any { it.category == "ios/mpv" && it.level == DiagnosticLevel.Warn })
        assertEquals("line=5", DiagnosticLogStore.entries.value.first().message)
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
