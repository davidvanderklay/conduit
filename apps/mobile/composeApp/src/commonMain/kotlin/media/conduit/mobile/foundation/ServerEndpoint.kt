package media.conduit.mobile.foundation

import kotlinx.serialization.Serializable

@Serializable
data class ServerEndpoint(
    val baseUrl: String,
    val label: String,
    val hosted: Boolean = false,
)

val DefaultServerEndpoint = ServerEndpoint(
    baseUrl = "https://conduit-api-62gd.onrender.com",
    label = "Default server",
    hosted = true,
)

sealed interface EndpointValidation {
    data class Valid(val endpoint: ServerEndpoint) : EndpointValidation
    data class Invalid(val message: String) : EndpointValidation
}

object ServerEndpointValidator {
    fun validate(input: String): EndpointValidation {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) return EndpointValidation.Invalid("Enter a server URL")
        if (trimmed.any(Char::isWhitespace)) {
            return EndpointValidation.Invalid("Server URLs cannot contain spaces")
        }

        val schemeEnd = trimmed.indexOf("://")
        if (schemeEnd <= 0) {
            return EndpointValidation.Invalid("Include https:// in the server URL")
        }
        val scheme = trimmed.substring(0, schemeEnd).lowercase()
        if (scheme != "https" && scheme != "http") {
            return EndpointValidation.Invalid("Server URLs must use HTTP or HTTPS")
        }
        val authority = trimmed.substring(schemeEnd + 3)
            .substringBefore('/')
            .substringBefore('?')
            .substringBefore('#')
        if (authority.isBlank() || authority.contains('@')) {
            return EndpointValidation.Invalid("Enter a valid server host without credentials")
        }
        val host = authority.substringBefore(':').lowercase()
        val localDevelopmentHost = host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2" || host.startsWith("192.168.") || host.startsWith("10.") || host.matches(Regex("172\\.(1[6-9]|2[0-9]|3[01])\\..*"))
        if (scheme != "https" && !localDevelopmentHost) {
            return EndpointValidation.Invalid("Use HTTPS unless connecting to a local development server")
        }

        return EndpointValidation.Valid(
            ServerEndpoint(
                baseUrl = trimmed,
                label = if (localDevelopmentHost) "Local development" else host,
            ),
        )
    }
}
