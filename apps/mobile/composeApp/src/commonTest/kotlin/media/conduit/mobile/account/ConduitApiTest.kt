package media.conduit.mobile.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class ConduitApiTest {
    @Test
    fun validatesHealthAndAuthenticationConfiguration() = runTest {
        val client = mockClient { path, _ ->
            when (path) {
                "/health" -> """{"status":"ok"}"""
                "/v1/auth/config" ->
                    """{"needsOwner":false,"localRegistration":false,"oidc":{"enabled":true,"provider":"google","displayName":"Continue with Google"}}"""
                else -> error("Unexpected path $path")
            }
        }

        val result = ConduitApi(client).validate("https://conduit.example")
        assertTrue(result.authentication.oidc.enabled)
        assertEquals("google", result.authentication.oidc.provider)
    }

    @Test
    fun bootstrapSendsBearerOnlyToSelectedServerRequest() = runTest {
        var authorization: String? = null
        val client = mockClient { _, header ->
            authorization = header
            """{"households":[{"id":"home","name":"Home","role":"owner","profiles":[{"id":"p1","name":"Alex","isKids":false}]}]}"""
        }

        val result = ConduitApi(client).bootstrap("https://conduit.example", "session-secret")
        assertEquals("Bearer session-secret", authorization)
        assertEquals("Alex", result.households.single().profiles.single().name)
    }

    @Test
    fun rejectsUnexpectedHealthResponse() = runTest {
        val client = mockClient { _, _ -> """{"status":"starting"}""" }
        assertFailsWith<ServerRequestException> {
            ConduitApi(client).validate("https://conduit.example")
        }
    }

    private fun mockClient(response: (path: String, authorization: String?) -> String): HttpClient {
        val engine = MockEngine { request ->
            respond(
                content = response(request.url.encodedPath, request.headers[HttpHeaders.Authorization]),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        return HttpClient(engine) { install(ContentNegotiation) { json() } }
    }
}
