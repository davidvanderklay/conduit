package media.conduit.mobile

import androidx.compose.runtime.Composable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import media.conduit.mobile.account.StreamItem

@Serializable
data class P2pSource(
    val infoHash: String? = null,
    val magnet: String? = null,
    val fileIndex: Int? = null,
    val sources: List<String> = emptyList(),
)

@Serializable
data class P2pMediaFile(val index: Int, val name: String, val size: Long)

@Serializable
data class P2pStatus(
    val phase: String,
    val streamUrl: String? = null,
    val files: List<P2pMediaFile> = emptyList(),
    val fileIndex: Int? = null,
    val verifiedBytes: Long = 0,
    val downloadBytesPerSecond: Long = 0,
    val diskBudget: Long = 0,
    val diskBytes: Long = 0,
    val readyAheadBytes: Long = 0,
    val peers: Int = 0,
    val error: String? = null,
)

internal expect val p2pCompiled: Boolean
internal expect fun createP2pEngine(): EngineClient?

/** Fail a mode mismatch before enabling any torrent controls. */
val p2pAvailable: Boolean by lazy {
    val client = EngineClient()
    try {
        val state = client.dispatch(EngineAction.P2pCapabilities()) as EngineState.P2pCapabilities
        check(state.available == p2pCompiled) { "Native P2P build capability mismatch" }
        state.available
    } finally { client.close() }
}

internal interface P2pEnvironment {
    val cacheDirectory: String
    fun transfersAllowed(): Boolean
    fun appActive(): Boolean
}

@Composable
internal expect fun rememberP2pEnvironment(): P2pEnvironment

internal data class PreparedP2p(val url: String, val requestId: String)
internal class P2pFileSelectionRequired(val files: List<P2pMediaFile>) : IllegalStateException("Select a torrent file")

/** The app-level playback session owns this controller, including minimized
 * playback. Foreign calls and handle destruction are serialized off the UI thread. */
internal class P2pSessionController {
    private val mutex = Mutex()
    private var client: EngineClient? = null
    @kotlin.concurrent.Volatile private var requestId: String? = null
    val activeRequestId: String? get() = requestId
    private var sequence = 0L

    suspend fun prepare(stream: StreamItem, environment: P2pEnvironment): PreparedP2p {
        var allocatedId: String? = null
        try {
            return withContext(Dispatchers.Default) {
                check(p2pAvailable) { "P2P is unavailable in this build" }
                check(environment.transfersAllowed()) { "Torrent playback requires an unmetered network and normal power mode" }
                check(environment.appActive()) { "Open the app to start torrent playback" }
                val id = mutex.withLock {
                    closeLocked()
                    val index = stream.fileIdx?.jsonPrimitive?.intOrNull
                    require(stream.fileIdx == null || (index != null && index >= 0)) { "Invalid torrent file index" }
                    val engine = checkNotNull(createP2pEngine())
                    client = engine
                    val id = "p2p-${++sequence}"
                    requestId = id
                    allocatedId = id
                    val response = engine.dispatch(EngineAction.StartP2p(
                        requestId = id,
                        cacheDirectory = environment.cacheDirectory,
                        source = P2pSource(stream.infoHash, stream.url?.takeIf { it.startsWith("magnet:", ignoreCase = true) }, index, stream.sources),
                    ))
                    checkSession(response)
                    id
                }
                withTimeout(95_000L) {
                    while (true) {
                        check(environment.transfersAllowed()) { "Torrent playback stopped because network or power policy changed" }
                        check(environment.appActive()) { "Torrent lookup stopped while the app is inactive" }
                        val status = mutex.withLock {
                            check(requestId == id) { "Torrent session was closed" }
                            checkSession(checkNotNull(client).dispatch(EngineAction.P2pStatus(requestId = id)))
                        }
                        when (status.phase) {
                            "ready" -> return@withTimeout PreparedP2p(checkNotNull(status.streamUrl), id)
                            "failed" -> {
                                if (status.error == "p2p_file_selection" && status.files.isNotEmpty()) throw P2pFileSelectionRequired(status.files)
                                error("Unable to stream this torrent. Try another source.")
                            }
                            "closed" -> error("Torrent session was closed")
                        }
                        delay(500)
                    }
                    @Suppress("UNREACHABLE_CODE") error("unreachable")
                }
            }
        } catch (cause: Throwable) {
            allocatedId?.let { id -> withContext(NonCancellable) { release(id) } }
            throw cause
        }
    }

    suspend fun update(paused: Boolean, allowed: Boolean) = withContext(Dispatchers.Default) {
        mutex.withLock {
            val id = requestId ?: return@withLock
            if (!allowed) closeLocked()
            else client?.dispatch(EngineAction.PauseP2p(requestId = id, paused = paused))
        }
    }

    suspend fun release(id: String? = null) = withContext(Dispatchers.Default) {
        mutex.withLock { if (id == null || requestId == id) closeLocked() }
    }

    private fun closeLocked() {
        client?.close()
        client = null
        requestId = null
    }

    private fun checkSession(response: EngineState): P2pStatus = when (response) {
        is EngineState.P2pSession -> response.status
        is EngineState.Error -> error(response.message)
        else -> error("Unexpected torrent session response")
    }
}
