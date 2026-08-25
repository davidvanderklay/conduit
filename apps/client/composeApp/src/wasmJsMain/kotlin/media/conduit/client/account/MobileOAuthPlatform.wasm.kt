package media.conduit.client.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

private class BrowserOAuthPlatform : MobileOAuthPlatform {
    override val callbackUrl: String? = null

    override fun createPkce(): PkcePair = error("Browser OAuth is not connected yet")
    override fun openSystemBrowser(url: String) = openBrowserWindow(url)
    override fun consumeCallback() = Unit
}

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("(url) => window.location.assign(url)")
private external fun openBrowserWindow(url: String)

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform = remember { BrowserOAuthPlatform() }
