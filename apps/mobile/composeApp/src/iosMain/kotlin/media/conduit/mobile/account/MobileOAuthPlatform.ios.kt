package media.conduit.mobile.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import media.conduit.mobile.foundation.IosOAuthBridge
import media.conduit.mobile.foundation.IosPlatformBridgeFactory

object IosOAuthCallbacks {
    internal val url = mutableStateOf<String?>(null)

    fun capture(url: String) {
        if (url.startsWith("conduit://oauth/callback")) this.url.value = url
    }
}

private class IosMobileOAuthPlatform(private val bridge: IosOAuthBridge) : MobileOAuthPlatform {
    override val callbackUrl: String? get() = IosOAuthCallbacks.url.value

    override fun createPkce(): PkcePair {
        val verifier = bridge.generateVerifier()
        return PkcePair(verifier, bridge.challenge(verifier))
    }

    override fun openSystemBrowser(url: String) = bridge.openSystemBrowser(url)
    override fun consumeCallback() { IosOAuthCallbacks.url.value = null }
}

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform {
    val bridge = checkNotNull(IosPlatformBridgeFactory.oauthBridge()) {
        "The iOS OAuth bridge was not registered by the application host"
    }
    return remember(bridge) { IosMobileOAuthPlatform(bridge) }
}
