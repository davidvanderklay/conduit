package media.conduit.mobile

/** User-selectable Android engine mode. Automatic keeps Media3 as the primary path. */
enum class AndroidPlaybackEngine(
    val label: String,
    val description: String,
) {
    Automatic("Automatic", "Use Media3 first and fall back to libmpv when playback fails"),
    Media3("Media3", "Use the Android Media3 player only"),
    Libmpv("libmpv", "Use the experimental libmpv player on Android"),
}

/** The engine currently producing the playback state. */
enum class NativePlaybackEngine {
    Media3,
    Libmpv,
}

internal data class PlaybackEngineSession(
    val preference: AndroidPlaybackEngine,
    val activeEngine: NativePlaybackEngine,
    val fallbackAttempted: Boolean = false,
    val fallbackReason: String? = null,
)

internal const val AndroidPlaybackStartupTimeoutMs = 10_000L

internal fun beginLibmpvFallback(
    session: PlaybackEngineSession,
    reason: String,
): PlaybackEngineSession? {
    if (!canFallbackToLibmpv(session.preference, session.activeEngine, session.fallbackAttempted)) return null
    return session.copy(
        activeEngine = NativePlaybackEngine.Libmpv,
        fallbackAttempted = true,
        fallbackReason = sanitizePlaybackError(reason),
    )
}

internal fun retryPlaybackEngine(session: PlaybackEngineSession): PlaybackEngineSession =
    if (session.preference == AndroidPlaybackEngine.Automatic &&
        session.activeEngine == NativePlaybackEngine.Libmpv &&
        session.fallbackAttempted
    ) {
        session.copy(
            activeEngine = NativePlaybackEngine.Media3,
            fallbackAttempted = false,
            fallbackReason = null,
        )
    } else {
        session
    }

internal fun combinedPlaybackError(fallbackReason: String?, libmpvError: String): String =
    if (fallbackReason == null) sanitizePlaybackError(libmpvError)
    else "Media3 failed: ${sanitizePlaybackError(fallbackReason)}\nlibmpv failed: ${sanitizePlaybackError(libmpvError)}"

internal fun shouldFallbackAfterStartup(
    elapsedMs: Long,
    firstFrameRendered: Boolean,
    fallbackAttempted: Boolean,
): Boolean = elapsedMs >= AndroidPlaybackStartupTimeoutMs &&
    !firstFrameRendered &&
    !fallbackAttempted

internal fun canFallbackToLibmpv(
    preference: AndroidPlaybackEngine,
    activeEngine: NativePlaybackEngine,
    fallbackAttempted: Boolean,
): Boolean = preference == AndroidPlaybackEngine.Automatic &&
    activeEngine == NativePlaybackEngine.Media3 &&
    !fallbackAttempted

internal fun fallbackPositionMs(currentPositionMs: Long, requestedPositionMs: Long): Long =
    maxOf(currentPositionMs, requestedPositionMs).coerceAtLeast(0L)

private val playbackUrlPattern = Regex("""(?i)\b(?:https?|rtmp|rtsp|file)://[^\s\"'<>]+""")
private val sensitiveParameterPattern = Regex(
    """(?i)([?&](?:access_token|auth|authorization|expires|hdnea|hdnts|key|sig|signature|token)=)[^&\s]+""",
)

internal fun sanitizePlaybackError(message: String): String = message
    .replace(playbackUrlPattern, "[redacted URL]")
    .replace(sensitiveParameterPattern, "$1[redacted]")
    .trim()
    .take(240)
