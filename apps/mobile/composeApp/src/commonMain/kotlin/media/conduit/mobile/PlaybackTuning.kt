package media.conduit.mobile

/** Captured for a playback session so changing settings does not reload an active stream. */
data class PlaybackTuning(
    val readAheadSeconds: Int? = null,
    val hardwareDecoding: Boolean = true,
) {
    val boundedReadAheadSeconds: Int? get() = readAheadSeconds?.coerceIn(10, 120)
}

/** Duration is a target; byte limits still bound memory for high-bitrate streams. */
internal fun PlaybackTuning.mpvBufferOptions(): Map<String, String> =
    boundedReadAheadSeconds?.let { seconds ->
        mapOf(
            "cache-secs" to seconds.toString(),
            "demuxer-readahead-secs" to seconds.toString(),
            "demuxer-max-bytes" to "64MiB",
            "demuxer-max-back-bytes" to "16MiB",
        )
    }.orEmpty()
