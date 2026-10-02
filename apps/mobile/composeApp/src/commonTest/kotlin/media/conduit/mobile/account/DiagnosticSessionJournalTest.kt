package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DiagnosticSessionJournalTest {
    @Test
    fun relaunchWithoutShutdownPreservesTwoPreviousSessions() {
        val files = MemorySessionFiles()
        repeat(4) { session ->
            val journal = DiagnosticSessionJournal(files, "session=$session")
            val history = journal.start()
            if (session == 3) {
                assertTrue("session=2" in history)
                assertTrue("session=1" in history)
                assertFalse("session=0" in history)
                assertTrue("termination cause unknown" in history)
            }
            journal.save(listOf(entry("event=$session")))
            // A new journal represents a new process. No shutdown callback runs.
        }
        assertEquals(setOf("current.log", "previous-1.log", "previous-2.log"), files.contents.keys)
        assertTrue("event=3" in files.contents.getValue("current.log"))
    }

    @Test
    fun byteLimitKeepsNewestCompleteUnicodeEntriesAndSessionHeader() {
        val files = MemorySessionFiles()
        val journal = DiagnosticSessionJournal(files, "session=test", maxBytes = 160)
        journal.start()
        journal.save((0..10).map { entry("event=$it " + "🎵".repeat(4)) })
        val text = files.contents.getValue("current.log")
        assertTrue(text.encodeToByteArray().size <= 160)
        assertTrue(text.startsWith("session=test"))
        assertTrue("event=10" in text)
        assertFalse("event=0 " in text)
        assertFalse("�" in text)
    }

    @Test
    fun clearingRemovesHistoryAndCurrentEntriesFromSubsequentSessions() {
        val files = MemorySessionFiles()
        val first = DiagnosticSessionJournal(files, "first")
        first.start()
        first.save(listOf(entry("private playback detail")))
        val second = DiagnosticSessionJournal(files, "second")
        second.start()
        second.save(listOf(entry("another playback detail")))
        second.clearHistory()
        second.save(emptyList())
        val history = DiagnosticSessionJournal(files, "third").start()
        assertFalse("playback detail" in history)
        assertFalse(files.contents.containsKey("previous-2.log"))
    }

    private fun entry(message: String) = DiagnosticLogEntry("2026-10-02T00:00:00Z", DiagnosticLevel.Info, "test", message)
}

internal class MemorySessionFiles : DiagnosticSessionFiles {
    val contents = mutableMapOf<String, String>()
    override fun read(name: String): String? = contents[name]
    override fun write(name: String, text: String) { contents[name] = text }
    override fun delete(name: String) { contents.remove(name) }
}
