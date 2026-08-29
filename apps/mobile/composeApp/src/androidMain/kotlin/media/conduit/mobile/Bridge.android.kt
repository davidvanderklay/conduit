package media.conduit.mobile

internal object RustBridge {
    init {
        System.loadLibrary("conduit_mobile")
    }

    external fun create(): Long
    external fun dispatch(handle: Long, action: String): String
    external fun evaluate(action: String): String
    external fun destroy(handle: Long)
}

internal actual fun evaluateCore(action: String): String = RustBridge.evaluate(action)

actual class RustEngine actual constructor() {
    private var handle = RustBridge.create()

    actual fun dispatch(json: String): String {
        check(handle != 0L) { "Rust engine is closed" }
        return RustBridge.dispatch(handle, json)
    }

    actual fun close() {
        if (handle != 0L) {
            RustBridge.destroy(handle)
            handle = 0
        }
    }
}
