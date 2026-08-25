package media.conduit.client

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

/** Kotlin implementation used by targets that do not ship the legacy Rust bridge. */
internal class KotlinEngine {
    private var generation = 0L
    private var closed = false

    fun dispatch(json: String): String {
        val action = ProtocolJson.decodeFromString<EngineAction>(json)
        val state = when {
            action.protocolVersion != ProtocolVersion -> EngineState.Error(
                protocolVersion = ProtocolVersion,
                code = "protocol_version_mismatch",
                message = "Expected protocol $ProtocolVersion, received ${action.protocolVersion}",
                recoverable = false,
            )
            closed -> EngineState.Error(
                protocolVersion = ProtocolVersion,
                code = "engine_closed",
                message = "The stream engine is closed",
                recoverable = false,
            )
            action is EngineAction.ResolveStreams -> {
                generation += 1
                EngineState.Resolved(
                    protocolVersion = ProtocolVersion,
                    requestId = action.requestId,
                    generation = generation,
                    addonName = "Conduit Fixture",
                    requestUrl = action.manifestUrl,
                    streamUrl = TestStreamUrl,
                    streamTitle = "Big Buck Bunny",
                )
            }
            action is EngineAction.Cancel -> {
                generation += 1
                EngineState.Cancelled(ProtocolVersion, action.requestId, generation)
            }
            action is EngineAction.Close -> {
                closed = true
                EngineState.Closed(ProtocolVersion)
            }
            else -> error("Unsupported engine action")
        }
        return ProtocolJson.encodeToString(state)
    }

    fun close() {
        closed = true
    }
}
