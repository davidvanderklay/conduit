package media.conduit.client.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

private class BrowserOAuthPlatform : MobileOAuthPlatform {
    override val callbackUrl: String?
        get() = browserCallbackUrl().takeIf(String::isNotBlank)

    override val redirectUri: String
        get() = browserRedirectUri()

    override suspend fun createPkce(): PkcePair {
        val verifier = secureRandomBase64Url(32)
        val challenge = sha256(verifier.encodeToByteArray()).toBase64Url()
        return PkcePair(verifier, challenge)
    }

    override fun openSystemBrowser(url: String) = openBrowserWindow(url)

    override fun consumeCallback() = clearBrowserCallback()
}

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("(url) => window.location.assign(url)")
private external fun openBrowserWindow(url: String)

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    () => {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      if (path !== '/oauth/callback' ||
          (!params.has('request') && !params.has('error'))) return '';
      return window.location.href;
    }
""")
private external fun browserCallbackUrl(): String

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("() => window.location.origin + '/oauth/callback'")
private external fun browserRedirectUri(): String

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("() => window.history.replaceState({}, document.title, window.location.origin + '/')")
private external fun clearBrowserCallback()

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    (byteLength) => {
      const bytes = new Uint8Array(byteLength);
      crypto.getRandomValues(bytes);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
""")
private external fun secureRandomBase64Url(byteLength: Int): String

private fun ByteArray.toBase64Url(): String {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    val result = StringBuilder((size * 4 + 2) / 3)
    var index = 0
    while (index < size) {
        val first = this[index++].toInt() and 0xff
        result.append(alphabet[first ushr 2])
        if (index >= size) {
            result.append(alphabet[(first and 0x03) shl 4])
            break
        }
        val second = this[index++].toInt() and 0xff
        result.append(alphabet[((first and 0x03) shl 4) or (second ushr 4)])
        if (index >= size) {
            result.append(alphabet[(second and 0x0f) shl 2])
            break
        }
        val third = this[index++].toInt() and 0xff
        result.append(alphabet[((second and 0x0f) shl 2) or (third ushr 6)])
        result.append(alphabet[third and 0x3f])
    }
    return result.toString()
}

/** Small SHA-256 implementation for the Wasm target, which has no JVM digest API. */
private fun sha256(input: ByteArray): ByteArray {
    val bitLength = input.size.toLong() * 8L
    val paddedLength = ((input.size + 9 + 63) / 64) * 64
    val message = ByteArray(paddedLength)
    input.copyInto(message)
    message[input.size] = 0x80.toByte()
    for (index in 0 until 8) {
        message[paddedLength - 1 - index] = (bitLength ushr (index * 8)).toByte()
    }

    val hash = intArrayOf(
        0x6a09e667, 0xbb67ae85.toInt(), 0x3c6ef372, 0xa54ff53a.toInt(),
        0x510e527f, 0x9b05688c.toInt(), 0x1f83d9ab, 0x5be0cd19,
    )
    val words = IntArray(64)
    var offset = 0
    while (offset < paddedLength) {
        for (index in 0 until 16) {
            val start = offset + index * 4
            words[index] = ((message[start].toInt() and 0xff) shl 24) or
                ((message[start + 1].toInt() and 0xff) shl 16) or
                ((message[start + 2].toInt() and 0xff) shl 8) or
                (message[start + 3].toInt() and 0xff)
        }
        for (index in 16 until 64) {
            val value = words[index - 15]
            val s0 = rotateRight(value, 7) xor rotateRight(value, 18) xor (value ushr 3)
            val next = words[index - 2]
            val s1 = rotateRight(next, 17) xor rotateRight(next, 19) xor (next ushr 10)
            words[index] = words[index - 16] + s0 + words[index - 7] + s1
        }

        var a = hash[0]
        var b = hash[1]
        var c = hash[2]
        var d = hash[3]
        var e = hash[4]
        var f = hash[5]
        var g = hash[6]
        var h = hash[7]
        for (index in 0 until 64) {
            val sigma1 = rotateRight(e, 6) xor rotateRight(e, 11) xor rotateRight(e, 25)
            val choice = (e and f) xor (e.inv() and g)
            val temp1 = h + sigma1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]
            val sigma0 = rotateRight(a, 2) xor rotateRight(a, 13) xor rotateRight(a, 22)
            val majority = (a and b) xor (a and c) xor (b and c)
            val temp2 = sigma0 + majority
            h = g
            g = f
            f = e
            e = d + temp1
            d = c
            c = b
            b = a
            a = temp1 + temp2
        }
        hash[0] += a
        hash[1] += b
        hash[2] += c
        hash[3] += d
        hash[4] += e
        hash[5] += f
        hash[6] += g
        hash[7] += h
        offset += 64
    }

    return ByteArray(32) { index ->
        (hash[index / 4] ushr (24 - (index % 4) * 8)).toByte()
    }
}

private fun rotateRight(value: Int, bits: Int): Int =
    (value ushr bits) or (value shl (32 - bits))

private val SHA256_ROUND_CONSTANTS = intArrayOf(
    0x428a2f98.toInt(), 0x71374491, 0xb5c0fbcf.toInt(), 0xe9b5dba5.toInt(),
    0x3956c25b, 0x59f111f1, 0x923f82a4.toInt(), 0xab1c5ed5.toInt(),
    0xd807aa98.toInt(), 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
    0x80deb1fe.toInt(), 0x9bdc06a7.toInt(), 0xc19bf174.toInt(), 0xe49b69c1.toInt(),
    0xefbe4786.toInt(), 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152.toInt(), 0xa831c66d.toInt(), 0xb00327c8.toInt(),
    0xbf597fc7.toInt(), 0xc6e00bf3.toInt(), 0xd5a79147.toInt(), 0x06ca6351,
    0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e.toInt(), 0x92722c85.toInt(),
    0xa2bfe8a1.toInt(), 0xa81a664b.toInt(), 0xc24b8b70.toInt(), 0xc76c51a3.toInt(),
    0xd192e819.toInt(), 0xd6990624.toInt(), 0xf40e3585.toInt(), 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814.toInt(),
    0x8cc70208.toInt(), 0x90befffa.toInt(), 0xa4506ceb.toInt(), 0xbef9a3f7.toInt(),
    0xc67178f2.toInt(),
)

@Composable
actual fun rememberMobileOAuthPlatform(): MobileOAuthPlatform = remember { BrowserOAuthPlatform() }
