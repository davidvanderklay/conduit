package media.conduit.mobile.account

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import media.conduit.mobile.EngineAction
import media.conduit.mobile.EngineClient
import media.conduit.mobile.EngineConnection
import media.conduit.mobile.EngineState
import media.conduit.mobile.ProtocolJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Golden-fixture conformance for the stream selection engine boundary
 * (ADR 0005). Fixtures live in packages/core and are shared with the Rust
 * and web conformance suites; this suite pins the Kotlin wire format to the
 * same canonical requests and responses.
 */
private class FakeConnection : EngineConnection {
    var dispatched: String? = null
    var response: String = ""

    override fun dispatch(json: String): String {
        dispatched = json
        return response
    }

    override fun close() {}
}

/** Locates packages/core/fixtures relative to the Gradle project directory. */
private fun readFixture(name: String): String {
    var dir = java.io.File(System.getProperty("user.dir"))
    repeat(6) {
        val candidate = java.io.File(dir, "packages/core/fixtures/stream-selection/$name")
        if (candidate.isFile) return candidate.readText()
        dir = dir.parentFile ?: return@repeat
    }
    error("fixture not found under any packages/core/fixtures from ${System.getProperty("user.dir")}: $name")
}

class StreamSelectionConformanceTest {

    private val fixtures: List<JsonObject> = listOf(
        "source-drops-transient-query-tokens",
        "source-torrent-identity",
        "source-other-text-identity",
        "source-normalizes-port-and-slash",
        "saved-matches-refreshed-token-url",
        "saved-rejects-same-addon-ambiguity",
        "saved-skips-unplayable-candidates",
        "rank-preference-order",
        "rank-device-cap-shapes-target",
        "rank-dedupes-normalized-urls",
        "single-auto-excludes-failed-source",
        "single-auto-rejects-ambiguity",
    ).map { name -> Json.parseToJsonElement(readFixture("$name.json")).jsonObject }

    private fun fixtureRequest(fixture: JsonObject) = fixture.getValue("request").jsonObject

    /** Drops default-null fields and per-call request ids so encodings compare structurally. */
    private fun canonicalize(element: kotlinx.serialization.json.JsonElement): kotlinx.serialization.json.JsonElement =
        when (element) {
            is JsonObject -> buildJsonObject {
                element.forEach { (key, value) ->
                    if (value !is JsonNull && key != "requestId") put(key, canonicalize(value))
                }
            }
            is kotlinx.serialization.json.JsonArray ->
                kotlinx.serialization.json.buildJsonArray { element.forEach { add(canonicalize(it)) } }
            else -> element
        }

    private fun engineAction(type: String, request: JsonObject): JsonObject = buildJsonObject {
        put("type", JsonPrimitive(type))
        put("protocolVersion", JsonPrimitive(2))
        put("requestId", JsonPrimitive("fixture"))
        request.forEach { (key, value) -> put(key, value) }
    }

    private fun engineResponse(type: String, expected: JsonObject): String = buildJsonObject {
        put("type", JsonPrimitive(type))
        put("protocolVersion", JsonPrimitive(2))
        put("requestId", JsonPrimitive("fixture"))
        expected.forEach { (key, value) -> put(key, value) }
    }.toString()

    @Test
    fun playbackSourceRequestsMatchTheCanonicalFixtureShape() {
        val fixture = fixtures.first { it.getValue("operation").jsonPrimitive.content == "playbackSource" }
        val connection = FakeConnection()
        val selection = StreamSelection(EngineClient(connection))
        val request = fixtureRequest(fixture)
        connection.response =
            engineResponse("sourceResolved", fixture.getValue("expected").jsonObject)

        val observed = selection.playbackSourceFor(
            request.getValue("addonId").jsonPrimitive.content,
            ProtocolJson.decodeFromJsonElement<StreamItem>(request.getValue("stream")),
        )

        assertEquals(
            canonicalize(engineAction("playbackSource", request)),
            canonicalize(Json.parseToJsonElement(connection.dispatched!!)),
        )
        assertEquals(
            ProtocolJson.decodeFromJsonElement<PlaybackSource>(
                fixture.getValue("expected").jsonObject.getValue("playbackSource"),
            ),
            observed,
        )
    }

    @Test
    fun savedSelectionRequestsMatchTheCanonicalFixtureShape() {
        for (fixture in fixtures.filter { it.getValue("operation").jsonPrimitive.content == "selectSavedStream" }) {
            val connection = FakeConnection()
            val selection = StreamSelection(EngineClient(connection))
            val request = fixtureRequest(fixture)
            val sources: List<StreamSource> =
                ProtocolJson.decodeFromJsonElement(request.getValue("sources"))
            val saved = request["saved"]
                ?.takeIf { it !is JsonNull }
                ?.let { ProtocolJson.decodeFromJsonElement<PlaybackSource>(it) }
            connection.response =
                engineResponse("savedStreamSelected", fixture.getValue("expected").jsonObject)

            val observed = selection.selectSavedStream(sources, saved)

            assertEquals(
                canonicalize(engineAction("selectSavedStream", request)),
                canonicalize(Json.parseToJsonElement(connection.dispatched!!)),
                fixture.getValue("name").jsonPrimitive.content,
            )
            val expectedIndex = fixture.getValue("expected").jsonObject["index"]!!
            if (expectedIndex is JsonNull) {
                assertNull(observed, fixture.getValue("name").jsonPrimitive.content)
            } else {
                assertEquals(sources[expectedIndex.jsonPrimitive.int], observed)
            }
        }
    }

    @Test
    fun singleAutoSelectionRequestsMatchTheCanonicalFixtureShape() {
        for (fixture in fixtures.filter { it.getValue("operation").jsonPrimitive.content == "selectSingleAutoStream" }) {
            val connection = FakeConnection()
            val selection = StreamSelection(EngineClient(connection))
            val request = fixtureRequest(fixture)
            val sources: List<StreamSource> =
                ProtocolJson.decodeFromJsonElement(request.getValue("sources"))
            val excluded = request["excluded"]
                ?.takeIf { it !is JsonNull }
                ?.let { ProtocolJson.decodeFromJsonElement<StreamItem>(it) }
            connection.response =
                engineResponse("autoStreamSelected", fixture.getValue("expected").jsonObject)

            val observed = selection.selectSingleAutoStream(
                sources,
                excluded?.let { item -> sources.first { candidate -> candidate.stream == item } },
            )

            assertEquals(
                canonicalize(engineAction("selectSingleAutoStream", request)),
                canonicalize(Json.parseToJsonElement(connection.dispatched!!)),
                fixture.getValue("name").jsonPrimitive.content,
            )
            val expectedIndex = fixture.getValue("expected").jsonObject["index"]!!
            if (expectedIndex is JsonNull) assertNull(observed)
            else assertEquals(sources[expectedIndex.jsonPrimitive.int], observed)
        }
    }

    @Test
    fun rankingRequestsMatchTheCanonicalFixtureShape() {
        for (fixture in fixtures.filter { it.getValue("operation").jsonPrimitive.content == "rankAutoStreams" }) {
            val connection = FakeConnection()
            val selection = StreamSelection(EngineClient(connection))
            val request = fixtureRequest(fixture)
            val sources: List<StreamSource> =
                ProtocolJson.decodeFromJsonElement(request.getValue("sources"))
            val previous = request["previous"]
                ?.takeIf { it !is JsonNull }
                ?.let { ProtocolJson.decodeFromJsonElement<PlaybackSource>(it) }
            val saved = request["saved"]
                ?.takeIf { it !is JsonNull }
                ?.let { ProtocolJson.decodeFromJsonElement<PlaybackSource>(it) }
            connection.response =
                engineResponse("autoStreamsRanked", fixture.getValue("expected").jsonObject)

            val device = request["device"]
                ?.takeIf { it !is JsonNull }
                ?.let { ProtocolJson.decodeFromJsonElement<media.conduit.mobile.DeviceConstraints>(it) }

            val observed = selection.rankAutomaticStreams(sources, previous, saved, device)

            assertEquals(
                canonicalize(engineAction("rankAutoStreams", request)),
                canonicalize(Json.parseToJsonElement(connection.dispatched!!)),
                fixture.getValue("name").jsonPrimitive.content,
            )
            val order = fixture.getValue("expected").jsonObject.getValue("order")
                .jsonArray.map { entry -> sources[entry.jsonPrimitive.int] }
            assertEquals(order, observed, fixture.getValue("name").jsonPrimitive.content)
        }
    }

    @Test
    fun deviceConstraintsRoundTripThroughTheWireFormat() {
        val action = EngineAction.RankAutoStreams(
            requestId = "fixture",
            sources = emptyList(),
            device = media.conduit.mobile.DeviceConstraints(maxResolutionHeight = 1080),
        )
        val encoded = ProtocolJson.encodeToString(action)
        assertTrue(encoded.contains("\"maxResolutionHeight\":1080"), encoded)
        val decoded = ProtocolJson.decodeFromString<EngineState>(
            """{"type":"autoStreamsRanked","protocolVersion":2,"requestId":"fixture","order":[1]}""",
        )
        assertIs<EngineState.AutoStreamsRanked>(decoded)
        assertEquals(listOf(1), decoded.order)
    }
}
