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

internal const val AndroidPlaybackStartupTimeoutMs = 10_000L

internal fun canFallbackToLibmpv(
    preference: AndroidPlaybackEngine,
    activeEngine: NativePlaybackEngine,
    fallbackAttempted: Boolean,
): Boolean = preference == AndroidPlaybackEngine.Automatic &&
    activeEngine == NativePlaybackEngine.Media3 &&
    !fallbackAttempted

internal fun fallbackPositionMs(currentPositionMs: Long, requestedPositionMs: Long): Long =
    maxOf(currentPositionMs, requestedPositionMs).coerceAtLeast(0L)
