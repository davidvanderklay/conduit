package media.conduit.mobile.account

internal const val diagnosticSessionMaxBytes = 128 * 1024

/** Platform file operations run only on the diagnostic writer's coroutine. */
internal interface DiagnosticSessionFiles {
    fun read(name: String): String?
    fun write(name: String, text: String)
    fun delete(name: String)
}

/** Retains the active process session and two predecessors, each bounded in UTF-8 bytes. */
internal class DiagnosticSessionJournal(
    private val files: DiagnosticSessionFiles,
    private val header: String,
    private val maxBytes: Int = diagnosticSessionMaxBytes,
) {
    fun start(): String {
        val current = files.read("current.log")
        val previous = files.read("previous-1.log")
        if (current != null) {
            if (previous != null) files.write("previous-2.log", previous) else files.delete("previous-2.log")
            files.write("previous-1.log", current)
        }
        save(emptyList())
        return history()
    }

    fun save(entries: List<DiagnosticLogEntry>) {
        val prefix = "$header\n\n"
        var bytes = prefix.encodeToByteArray().size
        val lines = buildList {
            for (entry in entries.asReversed()) {
                val line = entry.formatted + "\n"
                val size = line.encodeToByteArray().size
                if (bytes + size > maxBytes) break
                add(line)
                bytes += size
            }
        }.asReversed()
        files.write("current.log", prefix + lines.joinToString(""))
    }

    fun clearHistory() {
        files.delete("previous-1.log")
        files.delete("previous-2.log")
    }

    private fun history(): String = buildString {
        for (index in 1..2) {
            files.read("previous-$index.log")?.let { text ->
                appendLine("Previous session $index (termination cause unknown; unfiltered)")
                appendLine(text)
            }
        }
    }
}
