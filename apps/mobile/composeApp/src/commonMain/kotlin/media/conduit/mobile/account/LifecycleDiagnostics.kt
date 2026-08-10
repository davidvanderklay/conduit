package media.conduit.mobile.account

import kotlin.time.TimeSource

/** Emits lifecycle markers without credentials, callback codes, or media data. */
internal object LifecycleDiagnostics {
    fun event(name: String, detail: String? = null) {
        val suffix = detail?.takeIf(String::isNotBlank)?.let { " $it" }.orEmpty()
        println("[conduit.lifecycle] $name$suffix")
    }

    suspend inline fun <T> timed(name: String, crossinline block: suspend () -> T): T {
        val started = TimeSource.Monotonic.markNow()
        return try {
            block()
        } finally {
            event(name, "durationMs=${started.elapsedNow().inWholeMilliseconds}")
        }
    }
}
