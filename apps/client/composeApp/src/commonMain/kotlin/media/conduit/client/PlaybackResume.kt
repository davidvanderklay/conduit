package media.conduit.client

import media.conduit.client.account.ProgressSummary

/** Returns a safe starting point for a video-specific playback request. */
internal fun playbackStartPosition(progress: ProgressSummary?): Long {
    if (progress == null || progress.watched || progress.durationMs <= 0L) return 0L
    if (progress.positionMs >= progress.durationMs) return 0L
    return progress.positionMs.coerceAtLeast(0L)
}
