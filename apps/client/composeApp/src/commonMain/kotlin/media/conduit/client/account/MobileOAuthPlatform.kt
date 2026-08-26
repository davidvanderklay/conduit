package media.conduit.client.account

import androidx.compose.runtime.Composable
import kotlinx.coroutines.delay

data class PkcePair(val verifier: String, val challenge: String)

enum class OAuthFlow {
    Desktop,
    Mobile,
}

interface MobileOAuthPlatform {
    val flow: OAuthFlow get() = OAuthFlow.Mobile
    val callbackUrl: String?
    val redirectUri: String
    suspend fun prepareCallback() = Unit
    suspend fun createPkce(): PkcePair
    suspend fun awaitCallback(): String? {
        while (true) {
            callbackUrl?.let { return it }
            delay(250)
        }
    }
    fun openSystemBrowser(url: String)
    fun consumeCallback()
}

@Composable
expect fun rememberMobileOAuthPlatform(): MobileOAuthPlatform
