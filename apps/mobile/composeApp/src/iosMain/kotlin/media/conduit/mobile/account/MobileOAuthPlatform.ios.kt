package media.conduit.mobile.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

private object IosMobileOAuthPlatform : MobileOAuthPlatform {
    override val callbackUrl: String? = null
    override fun createPkce(): PkcePair = error("iOS OAuth requires the pending Keychain implementation")
    override fun openSystemBrowser(url: String) = Unit
    override fun consumeCallback() = Unit
}

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform = remember { IosMobileOAuthPlatform }
