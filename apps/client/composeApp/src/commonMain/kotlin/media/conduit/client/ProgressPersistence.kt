package media.conduit.client

import media.conduit.client.account.ProgressSummary

internal data class ResolvedProgressState(
    val positionMs: Long,
    val durationMs: Long,
    val watched: Boolean?,
)

/**
 * Loading and error callbacks are not authoritative playback positions. Keep
 * an existing row intact when the native player has not produced valid timing.
 */
internal fun resolveProgressState(
    candidate: PlaybackState,
    existing: ProgressSummary?,
): ResolvedProgressState? {
    val candidateIsValid = !candidate.loading &&
        candidate.error == null &&
        candidate.positionMs >= 0 &&
        candidate.durationMs > 0
    if (candidateIsValid) {
        return ResolvedProgressState(candidate.positionMs, candidate.durationMs, watched = null)
    }

    return existing?.let {
        ResolvedProgressState(
            positionMs = it.positionMs.coerceAtLeast(0),
            durationMs = it.durationMs.coerceAtLeast(0),
            watched = it.watched,
        )
    }
}
