package media.conduit.mobile.account

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Clock

/** A bounded, in-memory diagnostic buffer designed for user-supplied playback reports. */
internal object DiagnosticLogStore {
    const val maxEntries = 3_000
    private const val maxBytes = 512 * 1024
    private const val maxMessageLength = 2_000

    private val _entries = MutableStateFlow<List<DiagnosticLogEntry>>(emptyList())
    val entries: StateFlow<List<DiagnosticLogEntry>> = _entries.asStateFlow()

    private var debugLoggingEnabled = false

    fun setDebugLoggingEnabled(enabled: Boolean) {
        debugLoggingEnabled = enabled
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
    }

    fun copyText(entries: List<DiagnosticLogEntry> = _entries.value): String =
        entries.joinToString("\n", transform = DiagnosticLogEntry::formatted)

    private fun record(level: DiagnosticLevel, category: String, message: String) {
        if (level == DiagnosticLevel.Debug && !debugLoggingEnabled) return
        val safeCategory = category.trim().ifBlank { "app" }
        val safeMessage = sanitizeDiagnosticMessage(message).take(maxMessageLength)
        if (safeMessage.isBlank()) return
        val entry = DiagnosticLogEntry(
            timestamp = Clock.System.now().toString()
                .substringAfter('T')
                .take(8),
            level = level,
            category = safeCategory,
            message = safeMessage,
        )
        val recent = (_entries.value + entry).takeLast(maxEntries)
        var retainedBytes = 0
        val retained = buildList {
            for (candidate in recent.asReversed()) {
                val candidateBytes = candidate.formatted.length
                if (retainedBytes + candidateBytes > maxBytes) break
                add(candidate)
                retainedBytes += candidateBytes
            }
        }.asReversed()
        _entries.value = retained
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
    .replace(
        Regex("(?i)(authorization|cookie|token|password|secret)=\\S+"),
        "$1=[redacted]",
    )
    .replace(Regex("\\s+"), " ")
    .trim()
