package media.conduit.client.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import java.awt.Desktop
import java.net.URI
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

private class DesktopOAuthPlatform : MobileOAuthPlatform {
    private val callback = AtomicReference<String?>(null)
    @Volatile private var listener: ServerSocket? = null

    override val flow: OAuthFlow = OAuthFlow.Desktop
    override val callbackUrl: String? get() = callback.get()
    override val redirectUri: String
        get() = listener?.let { "http://127.0.0.1:${it.localPort}/oauth/callback" }
            ?: error("The desktop OAuth callback listener is not running")

    override suspend fun prepareCallback() {
        if (listener?.isClosed == false) return
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply {
            soTimeout = DesktopOAuthListenerTimeoutMs.toInt()
        }
        listener = server
        thread(isDaemon = true, name = "conduit-oauth-listener") {
            runCatching { acceptCallback(server) }
                .onFailure { cause ->
                    if (cause !is SocketTimeoutException) {
                        System.err.println("[conduit.oauth] callback listener failed: ${cause.message}")
                    }
                }
                .also {
                    server.close()
                    if (listener === server) listener = null
                }
        }
    }

    override suspend fun createPkce(): PkcePair {
        val verifier = encode(ByteArray(32).also(SecureRandom()::nextBytes))
        val challenge = encode(MessageDigest.getInstance("SHA-256").digest(verifier.encodeToByteArray()))
        return PkcePair(verifier, challenge)
    }

    override fun openSystemBrowser(url: String) {
        check(Desktop.isDesktopSupported()) { "Opening a browser is unavailable on this desktop" }
        Desktop.getDesktop().browse(URI(url))
    }

    override fun consumeCallback() {
        callback.set(null)
    }

    private fun acceptCallback(server: ServerSocket) {
        server.accept().use { socket ->
            val requestLine = socket.getInputStream().bufferedReader(Charsets.US_ASCII).readLine()
            val target = requestLine
                ?.split(' ', limit = 3)
                ?.takeIf { it.size == 3 && it[0] == "GET" }
                ?.get(1)
            val callbackUrl = target
                ?.let { URI("http://127.0.0.1:${server.localPort}$it") }
                ?.takeIf { it.path == "/oauth/callback" && it.userInfo == null }
                ?.toString()
            if (callbackUrl != null) callback.set(callbackUrl)
            writeResponse(socket, callbackUrl != null)
        }
    }

    private fun writeResponse(socket: java.net.Socket, success: Boolean) {
        val body = if (success) {
            "<!doctype html><title>Signed in to Conduit</title>" +
                "<style>body{color-scheme:dark;background:#09090b;color:#e4e4e7;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;max-width:32rem;padding:2rem}</style>" +
                "<main><h1>Return to Conduit</h1><p>Authentication is complete. You can close this tab and continue in the app.</p></main>"
        } else {
            "<!doctype html><title>Conduit sign-in failed</title><p>That authentication callback was invalid. Return to Conduit and try again.</p>"
        }
        val output = socket.getOutputStream().bufferedWriter(Charsets.UTF_8)
        output.use { writer ->
            writer.write("HTTP/1.1 ${if (success) "200 OK" else "400 Bad Request"}\r\n")
            writer.write("Content-Type: text/html; charset=utf-8\r\n")
            writer.write("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n")
            writer.write("Cache-Control: no-store\r\n")
            writer.write("Content-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n")
            writer.write("Connection: close\r\n\r\n")
            writer.write(body)
        }
    }

    private fun encode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)

    private companion object {
        const val DesktopOAuthListenerTimeoutMs = 5 * 60 * 1000L
    }
}

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform = remember { DesktopOAuthPlatform() }
