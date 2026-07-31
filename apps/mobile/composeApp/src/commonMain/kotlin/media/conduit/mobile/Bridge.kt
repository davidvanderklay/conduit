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

class EngineClient(private val engine: RustEngine = RustEngine()) {
    fun dispatch(action: EngineAction): EngineState =
        ProtocolJson.decodeFromString(engine.dispatch(ProtocolJson.encodeToString(action)))

    fun close() = engine.close()
}
