package media.conduit.mobile.account

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RefreshRequestsTest {
    @Test
    fun disposalCancelsASuspendedReceiverWithoutAnUnhandledChannelFailure() = runTest {
        val requests = RefreshRequests()
        val waiting = async { requests.next() }
        testScheduler.runCurrent()
        requests.close()
        kotlin.test.assertFailsWith<kotlinx.coroutines.CancellationException> { waiting.await() }
    }

    @Test
    fun eventBurstPreservesManualRefreshAndOnlyOnePendingHint() = runTest {
        val requests = RefreshRequests()
        val first = async { requests.next() }
        requests.request(true)
        repeat(10) { requests.request() }
        assertTrue(first.await())
        val second = async { requests.next() }
        testScheduler.runCurrent()
        assertFalse(second.isCompleted)
        requests.request()
        assertFalse(second.await())
        requests.close()
    }
}
