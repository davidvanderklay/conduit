package media.conduit.mobile.account

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay

/** One active refresh and one pending hint; a manual full refresh cannot be overwritten by a hint. */
internal class RefreshRequests {
    private val hints = Channel<Unit>(Channel.CONFLATED)
    private var fullResync = false

    fun request(full: Boolean = false) {
        fullResync = fullResync || full
        hints.trySend(Unit)
    }

    suspend fun next(): Boolean {
        hints.receive()
        delay(150)
        hints.tryReceive()
        val full = fullResync
        fullResync = false
        return full
    }

    fun close() = hints.cancel()
}
