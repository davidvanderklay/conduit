package media.conduit.mobile

import android.content.Context
import android.os.Build
import android.util.AttributeSet
import android.util.Log
import is.xyz.mpv.BaseMPVView
import is.xyz.mpv.MPV
import is.xyz.mpv.MPVNode
import is.xyz.mpv.Utils
import media.conduit.mobile.account.SubtitleItem

internal data class MpvPlaybackSnapshot(
    val loading: Boolean,
    val buffering: Boolean,
    val playing: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val videoWidth: Int,
    val videoHeight: Int,
    val ended: Boolean,
    val firstFrameRendered: Boolean,
    val error: String?,
    val trackRevision: Int,
)

internal data class MpvTrack(
    val id: Int,
    val type: String,
    val label: String,
    val language: String?,
    val selectionKey: String?,
    val selected: Boolean,
    val forced: Boolean,
)

/**
 * Small conduit-owned wrapper around the pinned mpv-android AAR. The view owns
 * the libmpv handle and exposes only the operations needed by the Compose
 * player and Android PiP boundary.
 */
internal class ConduitMpvView(
    context: Context,
    attrs: AttributeSet? = null,
) : BaseMPVView(context, attrs) {
    private var loaded = false
    private var ended = false
    private var errorMessage: String? = null
    private var trackRevision = 0
    private var currentUrl: String? = null
    private var currentHeaders: Map<String, String> = emptyMap()
    private var currentSubtitles: List<SubtitleItem> = emptyList()
    private var currentPreferredAudio = "System default"
    private var currentPreferredSubtitle = "English"
    private var currentPlaybackSpeed = 1f
    private var currentStartPositionMs = 0L
    private var currentPlayWhenReady = true
    private var currentSelectedSubtitleId: String? = null
    private var currentSubtitlesEnabled = true

    override fun initOptions() {
        setVo("gpu")
        mpv.setOptionString("profile", "fast")
        mpv.setOptionString("hwdec", "auto")
        mpv.setOptionString("msg-level", "all=warn")
        mpv.setOptionString("tls-verify", "yes")
        mpv.setOptionString("tls-ca-file", "${context.filesDir.path}/cacert.pem")
        mpv.setOptionString("demuxer-max-bytes", libmpvCacheBytes().toString())
        mpv.setOptionString("demuxer-max-back-bytes", libmpvCacheBytes().toString())
        mpv.setPropertyBoolean("keep-open", true)
        mpv.setPropertyBoolean("input-default-bindings", true)
        mpv.setPropertyBoolean("audio-fallback-to-null", true)
    }

    override fun postInitOptions() = Unit

    override fun observeProperties() {
        listOf(
            "pause" to MPV.mpvFormat.MPV_FORMAT_FLAG,
            "paused-for-cache" to MPV.mpvFormat.MPV_FORMAT_FLAG,
            "core-idle" to MPV.mpvFormat.MPV_FORMAT_FLAG,
            "eof-reached" to MPV.mpvFormat.MPV_FORMAT_FLAG,
            "seeking" to MPV.mpvFormat.MPV_FORMAT_FLAG,
            "cache-buffering-state" to MPV.mpvFormat.MPV_FORMAT_INT64,
            "duration" to MPV.mpvFormat.MPV_FORMAT_DOUBLE,
            "time-pos" to MPV.mpvFormat.MPV_FORMAT_DOUBLE,
            "speed" to MPV.mpvFormat.MPV_FORMAT_DOUBLE,
            "track-list" to MPV.mpvFormat.MPV_FORMAT_NODE,
        ).forEach { (property, format) -> mpv.observeProperty(property, format) }
    }

    fun installObservers(onChanged: () -> Unit) {
        if (!mpv.isInitialized()) return
        mpv.addObserver(object : MPV.EventObserver {
            override fun eventProperty(property: String) {
                if (property == "track-list") trackRevision++
                onChanged()
            }

            override fun eventProperty(property: String, value: Long) = onChanged()

            override fun eventProperty(property: String, value: Boolean) {
                if (property == "eof-reached") ended = value
                onChanged()
            }

            override fun eventProperty(property: String, value: String) = onChanged()

            override fun eventProperty(property: String, value: Double) = onChanged()

            override fun eventProperty(property: String, value: MPVNode) {
                if (property == "track-list") trackRevision++
                onChanged()
            }

            override fun event(eventId: Int, data: MPVNode) {
                when (eventId) {
                    MPV.mpvEvent.MPV_EVENT_START_FILE -> {
                        loaded = false
                        ended = false
                        errorMessage = null
                    }
                    MPV.mpvEvent.MPV_EVENT_FILE_LOADED -> {
                        loaded = true
                        errorMessage = null
                    }
                    MPV.mpvEvent.MPV_EVENT_VIDEO_RECONFIG,
                    MPV.mpvEvent.MPV_EVENT_PLAYBACK_RESTART,
                    -> {
                        loaded = true
                        errorMessage = null
                    }
                    MPV.mpvEvent.MPV_EVENT_END_FILE -> {
                        val reason = data.nodeString("reason")
                        if (reason == "error" || reason == "unknown") {
                            errorMessage = data.nodeString("error") ?: "libmpv could not play this stream"
                        }
                    }
                }
                onChanged()
            }
        })
    }

    fun loadSource(
        url: String,
        requestHeaders: Map<String, String>,
        subtitles: List<SubtitleItem>,
        startPositionMs: Long,
        playWhenReady: Boolean,
        preferredAudioLanguage: String,
        preferredSubtitleLanguage: String,
        playbackSpeed: Float = currentPlaybackSpeed,
        selectedSubtitleId: String? = currentSelectedSubtitleId,
        subtitlesEnabled: Boolean = currentSubtitlesEnabled,
    ) {
        if (!mpv.isInitialized()) {
            errorMessage = "libmpv could not be initialized on this device."
            return
        }
        currentUrl = url
        currentHeaders = requestHeaders
        currentSubtitles = subtitles
        currentPreferredAudio = preferredAudioLanguage
        currentPreferredSubtitle = preferredSubtitleLanguage
        currentPlaybackSpeed = playbackSpeed.coerceIn(0.25f, 4f)
        currentStartPositionMs = startPositionMs.coerceAtLeast(0L)
        currentPlayWhenReady = playWhenReady
        currentSelectedSubtitleId = selectedSubtitleId
        currentSubtitlesEnabled = subtitlesEnabled
        loaded = false
        ended = false
        errorMessage = null
        applyRequestHeaders(requestHeaders)
        setPreferredLanguages(preferredAudioLanguage, preferredSubtitleLanguage)
        setPlaybackSpeed(currentPlaybackSpeed)
        setPaused(!playWhenReady)
        val options = if (startPositionMs > 0) {
            arrayOf("start=${startPositionMs / 1000.0}")
        } else {
            emptyArray()
        }
        mpv.command("loadfile", url, "replace", *options)
        val preferredSubtitleCode = mpvLanguageCode(preferredSubtitleLanguage)
        val selectedSubtitleIndex = if (subtitlesEnabled) {
            subtitles.indexOfFirst { subtitle ->
                subtitleSelectionKey(subtitle) == selectedSubtitleId
            }.takeIf { it >= 0 } ?: subtitles.indexOfFirst { subtitle ->
                preferredSubtitleCode != null &&
                    subtitle.lang?.substringBefore('-')?.substringBefore('_') == preferredSubtitleCode
            }.takeIf { it >= 0 } ?: subtitles.indices.firstOrNull()
        } else {
            null
        }
        subtitles.forEachIndexed { index, subtitle ->
            mpv.command(
                "sub-add",
                subtitle.url,
                if (index == selectedSubtitleIndex) "select" else "cached",
                subtitle.addonName.orEmpty(),
                subtitle.lang.orEmpty(),
            )
        }
        if (!subtitlesEnabled) mpv.setPropertyString("sid", "no")
        setPaused(!playWhenReady)
    }

    fun retry(
        selectedSubtitleId: String? = currentSelectedSubtitleId,
        subtitlesEnabled: Boolean = currentSubtitlesEnabled,
    ) {
        currentSelectedSubtitleId = selectedSubtitleId
        currentSubtitlesEnabled = subtitlesEnabled
        currentUrl?.let {
            loadSource(
                url = it,
                requestHeaders = currentHeaders,
                subtitles = currentSubtitles,
                startPositionMs = resumePositionMs(),
                playWhenReady = currentPlayWhenReady,
                preferredAudioLanguage = currentPreferredAudio,
                preferredSubtitleLanguage = currentPreferredSubtitle,
                playbackSpeed = playbackSpeed(),
                selectedSubtitleId = selectedSubtitleId,
                subtitlesEnabled = subtitlesEnabled,
            )
        }
    }

    fun resumePositionMs(): Long = fallbackPositionMs(snapshot().positionMs, currentStartPositionMs)

    fun playWhenReady(): Boolean = currentPlayWhenReady

    fun setPaused(paused: Boolean) {
        currentPlayWhenReady = !paused
        if (!mpv.isInitialized()) return
        runCatching { mpv.setPropertyBoolean("pause", paused) }
    }

    fun seekTo(positionMs: Long) {
        if (!mpv.isInitialized()) return
        runCatching { mpv.command("seek", (positionMs.coerceAtLeast(0) / 1000.0).toString(), "absolute") }
    }

    fun seekBy(offsetMs: Long) {
        if (!mpv.isInitialized()) return
        runCatching { mpv.command("seek", (offsetMs / 1000.0).toString(), "relative") }
    }

    fun setPlaybackSpeed(speed: Float) {
        if (!mpv.isInitialized()) return
        runCatching { mpv.setPropertyDouble("speed", speed.coerceIn(0.25f, 4f).toDouble()) }
    }

    fun playbackSpeed(): Float = if (mpv.isInitialized()) {
        mpv.getPropertyDouble("speed")?.toFloat()?.takeIf { it.isFinite() } ?: 1f
    } else {
        1f
    }

    fun applyResizeMode(mode: Int) {
        if (!mpv.isInitialized()) return
        val panscan = when (mode) {
            ANDROID_RESIZE_MODE_ZOOM -> 0.5
            androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> 1.0
            else -> 0.0
        }
        runCatching {
            mpv.setPropertyDouble("panscan", panscan)
            mpv.setPropertyString("video-aspect-override", "no")
        }
    }

    fun tracks(type: String): List<MpvTrack> {
        if (!mpv.isInitialized()) return emptyList()
        return mpv.getPropertyNode("track-list")
            ?.asArray()
            ?.mapNotNull { node ->
                if (node.nodeString("type") != type) return@mapNotNull null
                val id = node.nodeInt("id") ?: return@mapNotNull null
                val externalFilename = node.nodeString("external-filename")
                val label = node.nodeString("title")
                    ?: externalFilename?.substringAfterLast('/')
                    ?: node.nodeString("codec")
                    ?: "Track $id"
                MpvTrack(
                    id = id,
                    type = type,
                    label = label,
                    language = node.nodeString("lang") ?: languageFromLabel(label),
                    selectionKey = externalFilename
                        ?.let { filename ->
                            currentSubtitles.firstOrNull { subtitle ->
                                subtitle.url == filename ||
                                    subtitle.url.substringBefore('#') == filename.substringBefore('#')
                            }
                        }
                        ?.let(::subtitleSelectionKey),
                    selected = node.nodeBoolean("selected") ?: false,
                    forced = node.nodeBoolean("forced") ?: false,
                )
            }
            .orEmpty()
    }

    fun selectAudio(trackId: Int?) {
        if (!mpv.isInitialized()) return
        if (trackId == null) mpv.setPropertyString("aid", "no") else mpv.setPropertyInt("aid", trackId)
    }

    fun selectSubtitle(trackId: Int?) {
        if (!mpv.isInitialized()) return
        if (trackId == null) mpv.setPropertyString("sid", "no") else mpv.setPropertyInt("sid", trackId)
    }

    fun snapshot(): MpvPlaybackSnapshot {
        if (!mpv.isInitialized()) {
            return MpvPlaybackSnapshot(
                loading = false,
                buffering = false,
                playing = false,
                positionMs = 0L,
                durationMs = 0L,
                videoWidth = 0,
                videoHeight = 0,
                ended = false,
                firstFrameRendered = false,
                error = errorMessage ?: "libmpv could not be initialized on this device.",
                trackRevision = trackRevision,
            )
        }
        val paused = mpv.getPropertyBoolean("pause") ?: true
        val pausedForCache = mpv.getPropertyBoolean("paused-for-cache") ?: false
        val idle = mpv.getPropertyBoolean("core-idle") ?: false
        val seeking = mpv.getPropertyBoolean("seeking") ?: false
        val cacheState = mpv.getPropertyInt("cache-buffering-state")
        val durationMs = mpv.getPropertyDouble("duration").toMillis()
        val positionMs = mpv.getPropertyDouble("time-pos").toMillis()
        val width = mpv.getPropertyInt("video-out-params/dw")
            ?: mpv.getPropertyInt("video-params/dw")
            ?: 0
        val height = mpv.getPropertyInt("video-out-params/dh")
            ?: mpv.getPropertyInt("video-params/dh")
            ?: 0
        // The pinned mpv-android AAR does not expose a rendered-frame callback;
        // dimensions after video reconfiguration are the available conservative proxy.
        val rendered = loaded && width > 0 && height > 0
        val buffering = loaded && !rendered && (pausedForCache || cacheState?.let { it in 0 until 100 } == true)
        return MpvPlaybackSnapshot(
            loading = !loaded || (!rendered && !ended && errorMessage == null),
            buffering = buffering || (loaded && seeking),
            playing = loaded && rendered && !paused && !pausedForCache && !idle && !ended,
            positionMs = positionMs,
            durationMs = durationMs,
            videoWidth = width,
            videoHeight = height,
            ended = ended || (mpv.getPropertyBoolean("eof-reached") ?: false),
            firstFrameRendered = rendered,
            error = errorMessage,
            trackRevision = trackRevision,
        )
    }

    private fun setPreferredLanguages(audio: String, subtitles: String) {
        mpvLanguageCode(audio)?.let { mpv.setPropertyString("alang", it) }
        mpvLanguageCode(subtitles)?.let { mpv.setPropertyString("slang", it) }
    }

    private fun applyRequestHeaders(headers: Map<String, String>) {
        val userAgent = headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.value
        if (!userAgent.isNullOrBlank()) mpv.setPropertyString("user-agent", userAgent)
        val serialized = headers
            .filterKeys { !it.equals("User-Agent", ignoreCase = true) }
            .map { (key, value) -> "${key}: ${value.replace("\\", "\\\\").replace(",", "\\,")}" }
            .joinToString(",")
        mpv.setPropertyString("http-header-fields", serialized)
    }

    companion object {
        fun create(context: Context): ConduitMpvView = ConduitMpvView(context).apply {
            runCatching {
                Utils.copyAssets(context)
                initialize(context.filesDir.path, context.cacheDir.path)
            }.onFailure { Log.e("ConduitMpv", "Failed to initialize libmpv", it) }
        }
    }
}

private fun libmpvCacheBytes(): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) 64 * 1024 * 1024 else 32 * 1024 * 1024

private fun Double?.toMillis(): Long = this?.takeIf { it.isFinite() && it > 0.0 }?.let { (it * 1000.0).toLong() } ?: 0L

private fun MPVNode.nodeString(key: String): String? = runCatching { this[key]?.asString() }.getOrNull()?.takeIf { it.isNotBlank() }
private fun MPVNode.nodeInt(key: String): Int? = runCatching { this[key]?.asInt()?.toInt() }.getOrNull()
private fun MPVNode.nodeBoolean(key: String): Boolean? = runCatching { this[key]?.asBoolean() }.getOrNull()

private fun languageFromLabel(label: String): String? {
    val normalized = label.lowercase()
    return when {
        "english" in normalized -> "en"
        "spanish" in normalized -> "es"
        "french" in normalized -> "fr"
        "german" in normalized -> "de"
        "japanese" in normalized -> "ja"
        "korean" in normalized -> "ko"
        else -> null
    }
}

private fun mpvLanguageCode(preference: String): String? = when (preference) {
    "System default" -> java.util.Locale.getDefault().language.takeIf(String::isNotBlank)
    "English" -> "en"
    "Spanish" -> "es"
    "French" -> "fr"
    "German" -> "de"
    "Japanese" -> "ja"
    "Korean" -> "ko"
    else -> null
}

internal fun subtitleSelectionKey(subtitle: SubtitleItem): String = subtitle.id ?: subtitle.url
