package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ProtocolTest {
    @Test
    fun decodesVersionedResolvedState() {
        val state = ProtocolJson.decodeFromString<EngineState>(
            """{"type":"resolved","protocolVersion":1,"generation":1,"addonName":"Fixture","requestUrl":"https://example.invalid/stream/movie/id.json","streamUrl":"$TestStreamUrl","streamTitle":"Test"}""",
        )
        assertIs<EngineState.Resolved>(state)
        assertEquals(ProtocolVersion, state.protocolVersion)
        assertEquals(TestStreamUrl, state.streamUrl)
    }

    @Test
    fun actionShapeIsStable() {
        val encoded = ProtocolJson.encodeToString<EngineAction>(EngineAction.Cancel())
        assertEquals("""{"type":"cancel","protocolVersion":1}""", encoded)
    }
}
