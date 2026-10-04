package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Composable
actual fun rememberProfileFiles(): ProfileFiles = remember {
    val bridge = checkNotNull(IosPlatformBridgeFactory.profileFiles()) { "The iOS file bridge was not registered" }
    object : ProfileFiles {
        override val canImport = true
        override val canExport = true
        override suspend fun pick(): ProfileFile? = suspendCancellableCoroutine { continuation ->
            bridge.pick { name, contents, error ->
                if (continuation.isActive) {
                    if (error != null) continuation.resumeWithException(IllegalArgumentException(error))
                    else continuation.resume(contents?.let { ProfileFile(name ?: "profile.json", it.encodeToByteArray()) })
                }
            }
        }
        override suspend fun save(name: String, contents: String): Boolean = suspendCancellableCoroutine { continuation ->
            bridge.save(name, contents) { saved, error ->
                if (continuation.isActive) {
                    if (error != null) continuation.resumeWithException(IllegalStateException(error))
                    else continuation.resume(saved)
                }
            }
        }
    }
}
