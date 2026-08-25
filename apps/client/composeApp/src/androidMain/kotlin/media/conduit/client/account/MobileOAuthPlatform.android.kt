package media.conduit.client.account

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import java.security.MessageDigest
import java.security.SecureRandom

internal object MobileOAuthCallbacks {
    val url = mutableStateOf<String?>(null)

    fun capture(intent: Intent?) {
        intent?.dataString?.takeIf { it.startsWith("conduit://oauth/callback") }?.let {
            url.value = it
        }
    }
}

private class AndroidMobileOAuthPlatform(private val context: Context) : MobileOAuthPlatform {
    override val callbackUrl: String? get() = MobileOAuthCallbacks.url.value

    override fun createPkce(): PkcePair {
        val verifier = base64(ByteArray(32).also(SecureRandom()::nextBytes))
        val challenge = base64(MessageDigest.getInstance("SHA-256").digest(verifier.encodeToByteArray()))
        return PkcePair(verifier, challenge)
    }

    override fun openSystemBrowser(url: String) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    override fun consumeCallback() {
        MobileOAuthCallbacks.url.value = null
    }

    private fun base64(value: ByteArray): String = Base64.encodeToString(
        value,
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )
}

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform {
    val context = LocalContext.current
    return remember(context) { AndroidMobileOAuthPlatform(context) }
}
