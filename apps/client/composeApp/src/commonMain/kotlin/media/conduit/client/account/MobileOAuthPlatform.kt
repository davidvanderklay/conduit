package media.conduit.client.account

import androidx.compose.runtime.Composable

data class PkcePair(val verifier: String, val challenge: String)

interface MobileOAuthPlatform {
    val callbackUrl: String?
    fun createPkce(): PkcePair
    fun openSystemBrowser(url: String)
    fun consumeCallback()
}

@Composable
expect fun rememberMobileOAuthPlatform(): MobileOAuthPlatform
