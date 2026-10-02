package media.conduit.mobile

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import media.conduit.mobile.account.DiagnosticLevel
import media.conduit.mobile.account.DiagnosticLogEntry
import media.conduit.mobile.account.DiagnosticSessionJournal

class DiagnosticSessionFilesTest {
    @Test
    fun persistedLogsSurviveReopeningFilesWithoutShutdown() {
        val directory = Files.createTempDirectory("conduit-session-test").toFile()
        try {
            val first = DiagnosticSessionJournal(AndroidDiagnosticSessionFiles(directory), "first process")
            first.start()
            first.save(listOf(DiagnosticLogEntry("now", DiagnosticLevel.Info, "player", "replacement requested")))
            val second = DiagnosticSessionJournal(AndroidDiagnosticSessionFiles(directory), "second process")
            val exported = second.start()
            assertTrue("first process" in exported)
            assertTrue("replacement requested" in exported)
            assertFalse(directory.resolve("current.log.tmp").exists())
            second.clearHistory()
            assertFalse(directory.resolve("previous-1.log").exists())
        } finally {
            directory.deleteRecursively()
        }
    }
}
