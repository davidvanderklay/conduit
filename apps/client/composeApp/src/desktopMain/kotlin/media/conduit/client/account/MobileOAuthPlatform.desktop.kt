package media.conduit.client.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import java.awt.Desktop
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

private class DesktopOAuthPlatform : MobileOAuthPlatform {
    override val callbackUrl: String? = null

    override fun createPkce(): PkcePair {
        val verifier = encode(ByteArray(32).also(SecureRandom()::nextBytes))
        val challenge = encode(MessageDigest.getInstance("SHA-256").digest(verifier.encodeToByteArray()))
        return PkcePair(verifier, challenge)
    }

    override fun openSystemBrowser(url: String) {
        check(Desktop.isDesktopSupported()) { "Opening a browser is unavailable on this desktop" }
        Desktop.getDesktop().browse(URI(url))
    }

    override fun consumeCallback() = Unit

    private fun encode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
}

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform = remember { DesktopOAuthPlatform() }
