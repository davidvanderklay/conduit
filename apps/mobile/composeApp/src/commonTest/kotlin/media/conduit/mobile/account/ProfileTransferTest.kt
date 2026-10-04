package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.*
import io.ktor.http.content.TextContent
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import kotlin.test.*

class ProfileTransferTest {
    private val archive = """{"format":"conduit-profile","version":1,"preferences":{"theme":"dark"},"library":[],"progress":[],"addons":[],"profile":{"name":"Main","isKids":false}}"""
    private val preview = """{"valid":true,"version":1,"profile":{"name":"Main","isKids":false},"counts":{"library":0,"progress":0,"addons":1},"importableAddons":0,"warnings":["Missing URL"]}"""

    @Test
    fun previewAndImportPreserveTheArchiveAndUseAuthenticatedProfileRoutes() = runTest {
        val requests = mutableListOf<String>()
        val modes = mutableListOf<String>()
        val data = parseProfileArchive(archive.encodeToByteArray())
        val client = HttpClient(MockEngine { request ->
            assertEquals("Bearer token", request.headers[HttpHeaders.Authorization])
            requests += request.url.encodedPath
            val body = Json.parseToJsonElement((request.body as TextContent).text).jsonObject
            if (request.url.encodedPath.endsWith("preview")) {
                assertEquals(data, body)
                respond(preview, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            } else {
                assertEquals(data, body["data"])
                modes += body.getValue("mode").jsonPrimitive.content
                respond("{}", headers = headersOf(HttpHeaders.ContentType, "application/json"))
            }
        }) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } }
        try {
            val api = ConduitApi(client)
            val result = api.previewProfileImport("https://server.test", "token", "profile", data)
            assertEquals(listOf("Missing URL"), result.warnings)
            assertEquals(0, result.importableAddons)
            api.importProfile("https://server.test", "token", "profile", data, ProfileImportMode.Merge)
            api.importProfile("https://server.test", "token", "profile", data, ProfileImportMode.Replace)
            assertEquals(listOf("merge", "replace"), modes)
            assertEquals(listOf("/v1/profiles/profile/import/preview", "/v1/profiles/profile/import", "/v1/profiles/profile/import"), requests)
        } finally { client.close() }
    }

    @Test
    fun exportExcludesSecretsUnlessRequested() = runTest {
        val includes = mutableListOf<String?>()
        val client = HttpClient(MockEngine { request ->
            assertEquals("Bearer token", request.headers[HttpHeaders.Authorization])
            includes += request.url.parameters["includeSecrets"]
            respond(archive, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }) { install(ContentNegotiation) { json() } }
        try {
            val api = ConduitApi(client)
            assertEquals(parseProfileArchive(archive.encodeToByteArray()), api.exportProfile("https://server.test", "token", "profile"))
            api.exportProfile("https://server.test", "token", "profile", true)
            assertEquals(listOf<String?>("false", "true"), includes)
        } finally { client.close() }
    }

    @Test
    fun invalidAndOversizedFilesAreRejectedBeforePreview() {
        assertFails { parseProfileArchive("[1]".encodeToByteArray()) }
        assertFails { parseProfileArchive("broken".encodeToByteArray()) }
        assertFails { parseProfileArchive(byteArrayOf(0xc3.toByte(), 0x28)) }
        assertFailsWith<IllegalArgumentException> { parseProfileArchive(ByteArray(MAX_PROFILE_IMPORT_BYTES + 1)) }
    }

    @Test
    fun serverValidationMessageIsShownAndNoImportIsSent() = runTest {
        var calls = 0
        val client = HttpClient(MockEngine {
            calls++
            respond("""{"message":"archive version 2 is newer than supported version 1"}""", HttpStatusCode.BadRequest, headersOf(HttpHeaders.ContentType, "application/json"))
        }) { install(ContentNegotiation) { json() } }
        try {
            val error = assertFailsWith<ServerRequestException> {
                ConduitApi(client).previewProfileImport("https://server.test", "token", "profile", parseProfileArchive(archive.encodeToByteArray()))
            }
            assertEquals(400, error.statusCode)
            assertEquals("archive version 2 is newer than supported version 1", error.message)
            assertEquals(1, calls)
        } finally { client.close() }
    }
}
