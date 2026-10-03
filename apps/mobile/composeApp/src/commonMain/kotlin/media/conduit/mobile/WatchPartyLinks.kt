package media.conduit.mobile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.ktor.http.Url

/** Keeps an invitation through sign-in until a profile can display the join sheet. */
object WatchPartyLinks {
    var pending by mutableStateOf<String?>(null)
        internal set

    fun capture(url: String): Boolean {
        val parsed = runCatching { Url(url) }.getOrNull() ?: return false
        if (parsed.protocol.name != "conduit" || parsed.host != "party") return false
        pending = url
        return true
    }
}

internal fun watchPartyInviteToken(input: String, baseUrl: String): String {
    val value = input.trim()
    if (!value.contains("://")) {
        require(value.matches(Regex("[A-Za-z0-9_-]{32,100}"))) { "Enter a valid invitation" }
        return value
    }
    val link = Url(value)
    val server = Url(baseUrl)
    if (link.protocol.name == "conduit" && link.host == "party") {
        require(link.parameters["server"]?.trimEnd('/') == baseUrl.trimEnd('/')) { "Connect to the invitation's server first" }
    } else {
        require(link.protocol.name in listOf("http", "https") && link.host == server.host) { "This invitation belongs to another server" }
        require(link.encodedPath.startsWith("/party/")) { "Enter a valid invitation" }
    }
    val token = link.encodedPath.substringAfterLast('/')
    require(token.matches(Regex("[A-Za-z0-9_-]{32,100}"))) { "Enter a valid invitation" }
    return token
}
