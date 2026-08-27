package media.conduit.mobile

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import media.conduit.mobile.account.StreamSource

internal const val STREAM_LOOKUP_TIMEOUT_MS = 15_000L

internal class StreamLookupTimeoutException : IllegalStateException("Finding streams took too long. Try again.")

internal suspend fun loadStreamsWithRetry(
    load: suspend () -> List<StreamSource>,
    timeoutMillis: Long = STREAM_LOOKUP_TIMEOUT_MS,
    timeoutFailure: () -> Throwable = { StreamLookupTimeoutException() },
): Result<List<StreamSource>> {
    suspend fun loadWithRetry(): Result<List<StreamSource>> {
        var result = Result.failure<List<StreamSource>>(IllegalStateException("Unable to load streams"))
        repeat(3) { attempt ->
            result = try {
                Result.success(load())
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Throwable) {
                Result.failure(cause)
            }
            if (result.isSuccess && result.getOrThrow().isNotEmpty()) return result
            if (attempt < 2) delay(400L * (attempt + 1))
        }
        return result
    }

    return withTimeoutOrNull(timeoutMillis) { loadWithRetry() }
        ?: Result.failure(timeoutFailure())
}
