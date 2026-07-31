package media.conduit.mobile.foundation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ServerEndpointTest {
    @Test
    fun normalizesHttpsEndpoint() {
        val result = ServerEndpointValidator.validate("  https://media.example.test/ ")
        assertIs<EndpointValidation.Valid>(result)
        assertEquals("https://media.example.test", result.endpoint.baseUrl)
    }

    @Test
    fun permitsEmulatorLoopbackOverHttp() {
        val result = ServerEndpointValidator.validate("http://10.0.2.2:3000")
        assertIs<EndpointValidation.Valid>(result)
        assertEquals("Local development", result.endpoint.label)
    }

    @Test
    fun rejectsRemoteCleartextAndCredentials() {
        assertIs<EndpointValidation.Invalid>(ServerEndpointValidator.validate("http://media.example.test"))
        assertIs<EndpointValidation.Invalid>(ServerEndpointValidator.validate("https://user:secret@example.test"))
    }
}
