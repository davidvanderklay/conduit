package media.conduit.client

actual class RustEngine actual constructor() {
    private val engine = KotlinEngine()

    actual fun dispatch(json: String): String = engine.dispatch(json)
    actual fun close() = engine.close()
}
