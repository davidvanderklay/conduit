package media.conduit.mobile

import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.foundation.ResumeBehavior

/** Returns a safe starting point for a video-specific playback request. */
internal fun playbackStartPosition(progress: ProgressSummary?): Long {
    if (progress == null || progress.watched || progress.durationMs <= 0L) return 0L
    if (progress.positionMs >= progress.durationMs) return 0L
    return progress.positionMs.coerceAtLeast(0L)
}

internal sealed interface PlaybackResumeDecision {
    data class Start(val positionMs: Long) : PlaybackResumeDecision
    data class Ask(val positionMs: Long) : PlaybackResumeDecision
}

/** Explicit actions and an existing session take precedence over fresh-start policy. */
internal fun playbackResumeDecision(
    behavior: ResumeBehavior,
    savedPositionMs: Long,
    explicitPositionMs: Long? = null,
    retainedPositionMs: Long? = null,
): PlaybackResumeDecision {
    val override = explicitPositionMs ?: retainedPositionMs
    if (override != null) return PlaybackResumeDecision.Start(override.coerceAtLeast(0L))
    val position = savedPositionMs.coerceAtLeast(0L)
    return when {
        position == 0L -> PlaybackResumeDecision.Start(0L)
        behavior == ResumeBehavior.Restart -> PlaybackResumeDecision.Start(0L)
        behavior == ResumeBehavior.Always -> PlaybackResumeDecision.Start(position)
        else -> PlaybackResumeDecision.Ask(position)
    }
}
