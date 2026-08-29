package media.conduit.mobile

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

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
    val value = coreValue(buildJsonObject {
        put("type", "audioTrackDisplay")
        put("info", buildJsonObject {
            put("title", info.title)
            put("languageName", info.languageName)
            put("codec", info.codec)
            put("channels", info.channels)
            put("channelCount", info.channelCount)
            put("sampleRate", info.sampleRate)
            put("bitrate", info.bitrate)
        })
        put("fallback", fallback)
    }).jsonObject
    return AudioTrackDisplay(
        primary = value.getValue("primary").jsonPrimitive.content,
        secondary = value.getValue("secondary").jsonPrimitive.content,
    )
}
