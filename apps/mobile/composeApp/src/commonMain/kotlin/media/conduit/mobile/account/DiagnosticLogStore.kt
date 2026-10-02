package media.conduit.mobile.account

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Clock

/** Bounded live diagnostics with optional process-session persistence and historical exports. */
internal object DiagnosticLogStore {
    const val maxEntries = 3_000
    private const val maxBytes = diagnosticSessionMaxBytes
    private const val maxMessageLength = 2_000

    private val _entries = MutableStateFlow<List<DiagnosticLogEntry>>(emptyList())
    val entries: StateFlow<List<DiagnosticLogEntry>> = _entries.asStateFlow()

    private val debugLoggingEnabled = MutableStateFlow(false)
    private val previousSessions = MutableStateFlow("")
    private val clearGeneration = MutableStateFlow(0L)
    private val writerSignals = Channel<Unit>(Channel.CONFLATED)
    private var persistenceStarted = false
    private var sessionHeader = ""

    /** Called once by the platform host before starting the UI or player. */
    fun startPersistence(files: DiagnosticSessionFiles, context: String) {
        if (persistenceStarted) return
        persistenceStarted = true
        sessionHeader = "Conduit diagnostic session ${Clock.System.now()}\n${sanitizeDiagnosticMessage(context).take(maxMessageLength)}"
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val journal = DiagnosticSessionJournal(files, sessionHeader)
                previousSessions.value = journal.start()
                var cleared = 0L
                writerSignals.trySend(Unit)
                for (signal in writerSignals) {
                    val generation = clearGeneration.value
                    if (generation != cleared) {
                        journal.clearHistory()
                        previousSessions.value = ""
                        cleared = generation
                    }
                    journal.save(_entries.value)
                    // Conflation bounds pending work; frequent events cannot postpone writes indefinitely.
                    delay(250)
                }
            } catch (_: Exception) {
                warn("diagnostics/storage", "Session log persistence unavailable; live logs remain available")
            }
        }
        info("app/session", "started $context")
    }

    fun setDebugLoggingEnabled(enabled: Boolean) {
        debugLoggingEnabled.value = enabled
    }

    fun debug(category: String, message: String) {
        record(DiagnosticLevel.Debug, category, message)
    }

    fun info(category: String, message: String) {
        record(DiagnosticLevel.Info, category, message)
    }

    fun warn(category: String, message: String) {
        record(DiagnosticLevel.Warn, category, message)
    }

    fun error(category: String, message: String) {
        record(DiagnosticLevel.Error, category, message)
    }

    /** Adds a native event encoded as `level<TAB>category<TAB>message`. */
    fun recordNativeEvent(encoded: String) {
        encoded.lineSequence()
            .map(String::trim)
            .filter(String::isNotEmpty)
            .forEach { line ->
                val fields = line.split('\t', limit = 3)
                if (fields.size != 3) {
                    debug("ios.bridge", line)
                    return@forEach
                }
                val level = when (fields[0].lowercase()) {
                    "error", "fatal" -> DiagnosticLevel.Error
                    "warn", "warning" -> DiagnosticLevel.Warn
                    "info" -> DiagnosticLevel.Info
                    else -> DiagnosticLevel.Debug
                }
                record(level, fields[1].ifBlank { "ios.bridge" }, fields[2])
            }
    }

    fun clear() {
        _entries.value = emptyList()
        previousSessions.value = ""
        clearGeneration.update { it + 1 }
        writerSignals.trySend(Unit)
    }

    fun copyText(entries: List<DiagnosticLogEntry> = _entries.value): String = buildString {
        if (sessionHeader.isNotEmpty()) appendLine("Current session\n$sessionHeader\n")
        appendLine(entries.joinToString("\n", transform = DiagnosticLogEntry::formatted))
        if (previousSessions.value.isNotEmpty()) {
            appendLine()
            append(previousSessions.value)
        }
    }.trimEnd()

    private fun record(level: DiagnosticLevel, category: String, message: String) {
        if (level == DiagnosticLevel.Debug && !debugLoggingEnabled.value) return
        val safeCategory = sanitizeDiagnosticMessage(category).take(120).ifBlank { "app" }
        val safeMessage = sanitizeDiagnosticMessage(message).take(maxMessageLength)
        if (safeMessage.isBlank()) return
        val entry = DiagnosticLogEntry(
            timestamp = Clock.System.now().toString(),
            level = level,
            category = safeCategory,
            message = safeMessage,
        )
        _entries.update { current ->
            val recent = (current + entry).takeLast(maxEntries)
            var retainedBytes = 0
            buildList {
                for (candidate in recent.asReversed()) {
                    val candidateBytes = candidate.formatted.encodeToByteArray().size
                    if (retainedBytes + candidateBytes > maxBytes) break
                    add(candidate)
                    retainedBytes += candidateBytes
                }
            }.asReversed()
        }
        writerSignals.trySend(Unit)
    }
}

internal enum class DiagnosticLevel(val label: String) {
    Debug("Debug"),
    Info("Info"),
    Warn("Warn"),
    Error("Error"),
}

internal data class DiagnosticLogEntry(
    val timestamp: String,
    val level: DiagnosticLevel,
    val category: String,
    val message: String,
) {
    val categoryGroup: String get() = category.substringBefore('/').ifBlank { category }
    val formatted: String get() = "$timestamp [${level.label}] [$category] $message"
}

private fun sanitizeDiagnosticMessage(value: String): String = value
    .replace(Regex("https?://\\S+", RegexOption.IGNORE_CASE), "[url]")
    .replace(Regex("(?im)(authorization|cookie)\\s*[:=]\\s*[^\\r\\n]*"), "$1=[redacted]")
    .replace(
        Regex("""(?i)("?(?:access_token|refresh_token|api[_-]?key|token|password|secret)"?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)"""),
        "$1[redacted]",
    )
    .replace(Regex("\\s+"), " ")
    .trim()
