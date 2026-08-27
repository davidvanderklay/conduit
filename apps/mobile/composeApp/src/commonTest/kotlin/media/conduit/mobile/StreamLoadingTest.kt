package media.conduit.mobile

import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class StreamLoadingTest {
    @Test
    fun hangingStreamLookupSettlesWithATimeoutFailure() = runTest {
        val result = loadStreamsWithRetry(
            load = { awaitCancellation() },
            timeoutMillis = 100,
        )

        assertIs<StreamLookupTimeoutException>(result.exceptionOrNull())
    }

    @Test
    fun cancellationFromARefreshDoesNotRetryTheOldLookup() = runTest {
        var attempts = 0

        val failure = assertFailsWith<CancellationException> {
            loadStreamsWithRetry(
                load = {
                    attempts += 1
                    throw CancellationException("superseded")
                },
                timeoutMillis = 1_000,
            )
        }

        assertEquals("superseded", failure.message)
        assertEquals(1, attempts)
    }
}
