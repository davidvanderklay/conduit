package media.conduit.mobile

data class AudioTrackDisplayInfo(
    val title: String,
    val languageCode: String? = null,
    val languageName: String,
    val codec: String? = null,
    val channels: String? = null,
    val channelCount: Int? = null,
    val sampleRate: Int? = null,
    val bitrate: Long? = null,
)

data class AudioTrackDisplay(
    val primary: String,
    val secondary: String,
)

fun audioTrackDisplay(info: AudioTrackDisplayInfo, fallback: String): AudioTrackDisplay {
    val codec = audioCodecName(info.codec)
    val base = info.title.trim().ifBlank { fallback }
    val channelSummary = audioChannelSummary(info.channelCount, info.channels)
    val sampleRate = info.sampleRate?.takeIf { it > 0 }?.let(::formatSampleRate)
    val bitrate = info.bitrate?.takeIf { it > 0 }?.let { "${it / 1_000} kbps" }
    val technical = listOfNotNull(
        info.channels?.trim()?.takeIf(String::isNotBlank) ?: channelSummary,
        sampleRate,
        bitrate,
        codec?.takeIf { !base.contains(it, ignoreCase = true) },
    ).joinToString(", ").takeIf(String::isNotBlank)?.let { "($it)" }

    return AudioTrackDisplay(
        primary = base + technical?.let { " $it" }.orEmpty(),
        secondary = info.languageName.ifBlank { "Unknown language" },
    )
}

private fun audioChannelSummary(channelCount: Int?, channels: String?): String? = when (channelCount) {
    1 -> "Mono"
    2 -> "Stereo"
    6 -> "5.1"
    8 -> "7.1"
    null, 0 -> channels?.substringBefore('(')?.trim()?.takeIf(String::isNotBlank)
    else -> "$channelCount channels"
}

private fun formatSampleRate(sampleRate: Int): String = if (sampleRate % 1_000 == 0) {
    "${sampleRate / 1_000} kHz"
} else {
    "${sampleRate / 1_000.0} kHz"
}

private fun audioCodecName(codec: String?): String? = when (
    val normalized = codec?.substringAfterLast('/')?.lowercase()?.replace("_", "-")
) {
    null, "" -> null
    "ac3", "ac-3" -> "AC-3"
    "eac3", "e-ac-3", "ec-3" -> "E-AC-3"
    "truehd", "mlp-fba" -> "TrueHD"
    "dts-hd", "dts-hd-ma" -> "DTS-HD"
    "dts" -> "DTS"
    "aac", "mp4a-latm" -> "AAC"
    "opus" -> "Opus"
    "vorbis" -> "Vorbis"
    "flac" -> "FLAC"
    else -> normalized.uppercase()
}
