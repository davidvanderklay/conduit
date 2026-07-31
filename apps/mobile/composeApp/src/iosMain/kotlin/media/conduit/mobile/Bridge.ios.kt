package media.conduit.mobile

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.toKString
import media.conduit.mobile.ffi.*

@OptIn(ExperimentalForeignApi::class)
actual class RustEngine actual constructor() {
    private var handle = conduit_engine_new()

    actual fun dispatch(json: String): String {
        val engine = checkNotNull(handle) { "Rust engine is closed" }
        val response = conduit_engine_dispatch(engine, json)
        try {
            return checkNotNull(response).toKString()
        } finally {
            conduit_string_free(response)
        }
    }

    actual fun close() {
        handle?.let(::conduit_engine_free)
        handle = null
    }
}
