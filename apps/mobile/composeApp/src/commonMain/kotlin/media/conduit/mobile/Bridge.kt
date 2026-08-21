package media.conduit.mobile

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal val ProtocolJson = Json {
    classDiscriminator = "type"
    encodeDefaults = true
    ignoreUnknownKeys = true
}

expect class RustEngine() {
    fun dispatch(json: String): String
    fun close()
}

/** Transport boundary so tests can fake the native engine. */
interface EngineConnection {
    fun dispatch(json: String): String
    fun close()
}

class RustConnection : EngineConnection {
    private val engine = RustEngine()

    override fun dispatch(json: String): String = engine.dispatch(json)

    override fun close() = engine.close()
}

class EngineClient(private val connection: EngineConnection = RustConnection()) : AutoCloseable {
    fun dispatch(action: EngineAction): EngineState =
        ProtocolJson.decodeFromString(connection.dispatch(ProtocolJson.encodeToString(action)))

    override fun close() = connection.close()
}
