package media.conduit.mobile

import android.content.Context
import android.os.Build
import android.util.AttributeSet
import android.util.Log
import `is`.xyz.mpv.BaseMPVView
import `is`.xyz.mpv.MPV
import `is`.xyz.mpv.MPVNode
import `is`.xyz.mpv.Utils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
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
    val playbackSpeed: Float,
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

private data class MpvLoadRequest(
    val generation: Long,
    val url: String,
    val requestHeaders: Map<String, String>,
    val subtitles: List<SubtitleItem>,
    val startPositionMs: Long,
    val playWhenReady: Boolean,
    val preferredAudioLanguage: String,
    val preferredSubtitleLanguage: String,
    val playbackSpeed: Float,
    val subtitlesEnabled: Boolean,
)

private const val EmbeddedSubtitleSelectionPrefix = "embedded:"

/**
 * Small conduit-owned wrapper around the pinned mpv-android AAR. The view owns
 * the libmpv handle and exposes only the operations needed by the Compose
 * player and Android PiP boundary.
 */
internal class ConduitMpvView(
    context: Context,
    attrs: AttributeSet? = null,
) : BaseMPVView(context, attrs) {
    @Volatile private var loaded = false
    @Volatile private var fileLoadStarted = false
    @Volatile private var ended = false
    @Volatile private var errorMessage: String? = null
    @Volatile private var trackRevision = 0
    @Volatile private var currentUrl: String? = null
    @Volatile private var currentHeaders: Map<String, String> = emptyMap()
    @Volatile private var currentSubtitles: List<SubtitleItem> = emptyList()
    @Volatile private var currentPreferredAudio = "System default"
    @Volatile private var currentPreferredSubtitle = "English"
    @Volatile private var currentPlaybackSpeed = 1f
    @Volatile private var currentStartPositionMs = 0L
    @Volatile private var currentPlayWhenReady = true
    @Volatile private var currentSelectedSubtitleId: String? = null
    @Volatile private var currentSelectedSubtitleLanguage: String? = null
    @Volatile private var currentSelectedSubtitleLabel: String? = null
    @Volatile private var currentSubtitlesEnabled = true
    @Volatile private var preferredSubtitleApplied = false
    @Volatile private var trackCacheRefreshRequested = true
    @Volatile private var initialVideoOutputReady = false
    @Volatile private var pendingExternalSubtitles: List<SubtitleItem> = emptyList()
    @Volatile private var externalSubtitleLoadQueued = false
    @Volatile private var loadGeneration = 0L
    @Volatile private var activeLoadGeneration = 0L
    @Volatile private var lastLoadSignature: String? = null
    private var lastResizeMode: Int? = null
    private val nativeLock = Any()
    private val nativeScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private val subtitleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var destroyed = false
    private var surfaceReady = false
    private var pendingLoadRequest: MpvLoadRequest? = null
    private var snapshotRefreshQueued = false
    @Volatile private var cachedTracks: Map<String, List<MpvTrack>> = emptyMap()
    @Volatile private var cachedSnapshot = MpvPlaybackSnapshot(
        loading = true,
        buffering = false,
        playing = false,
        positionMs = 0L,
        durationMs = 0L,
        videoWidth = 0,
        videoHeight = 0,
        ended = false,
        firstFrameRendered = false,
        error = null,
        trackRevision = 0,
        playbackSpeed = 1f,
    )

    override fun initOptions() {
        setVo("gpu")
        mpv.setOptionString("gpu-context", "android")
        mpv.setOptionString("profile", "fast")
        // Direct MediaCodec rendering intermittently loses the SurfaceView's
        // native window on Android. Copying decoded frames keeps the GPU VO
        // path intact and lets mpv fall back to software decoding quickly.
        mpv.setOptionString("hwdec", "auto-copy")
        mpv.setOptionString("hwdec-software-fallback", "yes")
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
        if (!mpv.isInitialized) return
        mpv.addObserver(object : MPV.EventObserver {
            override fun eventProperty(property: String) {
                if (property == "track-list") {
                    trackRevision++
                    trackCacheRefreshRequested = true
                }
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
                if (property == "track-list") {
                    trackRevision++
                    trackCacheRefreshRequested = true
                }
                onChanged()
            }

            override fun event(eventId: Int, data: MPVNode) {
                when (eventId) {
                    MPV.mpvEvent.MPV_EVENT_START_FILE -> {
                        Log.d("ConduitMpv", "event start-file")
                        fileLoadStarted = true
                        loaded = false
                        initialVideoOutputReady = false
                        ended = false
                        errorMessage = null
                    }
                    MPV.mpvEvent.MPV_EVENT_FILE_LOADED -> {
                        Log.d("ConduitMpv", "event file-loaded")
                        loaded = true
                        errorMessage = null
                        trackCacheRefreshRequested = true
                    }
                    MPV.mpvEvent.MPV_EVENT_VIDEO_RECONFIG,
                    MPV.mpvEvent.MPV_EVENT_PLAYBACK_RESTART,
                    -> {
                        Log.d(
                            "ConduitMpv",
                            "event ${if (eventId == MPV.mpvEvent.MPV_EVENT_VIDEO_RECONFIG) "video-reconfig" else "playback-restart"}",
                        )
                        if (fileLoadStarted) loaded = true
                        errorMessage = null
                        if (fileLoadStarted) trackCacheRefreshRequested = true
                    }
                    MPV.mpvEvent.MPV_EVENT_END_FILE -> {
                        val reason = data.nodeString("reason")
                        Log.d("ConduitMpv", "event end-file reason=$reason error=${data.nodeString("error")}")
                        fileLoadStarted = false
                        loaded = false
                        if (reason == "error" || reason == "unknown") {
                            errorMessage = sanitizePlaybackError(
                                data.nodeString("error") ?: "libmpv could not play this stream",
                            )
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
        selectedSubtitleLanguage: String? = currentSelectedSubtitleLanguage,
        selectedSubtitleLabel: String? = currentSelectedSubtitleLabel,
        subtitlesEnabled: Boolean = currentSubtitlesEnabled,
    ) {
        if (!mpv.isInitialized) {
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
        currentSelectedSubtitleLanguage = selectedSubtitleLanguage
        currentSelectedSubtitleLabel = selectedSubtitleLabel
        currentSubtitlesEnabled = subtitlesEnabled
        preferredSubtitleApplied = false
        val loadSignature = listOf(
            url,
            requestHeaders,
            subtitles,
            startPositionMs.coerceAtLeast(0L),
            playWhenReady,
            preferredAudioLanguage,
            preferredSubtitleLanguage,
            currentPlaybackSpeed,
            selectedSubtitleId,
            selectedSubtitleLanguage,
            selectedSubtitleLabel,
            subtitlesEnabled,
        ).toString()
        if (loadSignature == lastLoadSignature) {
            Log.d("ConduitMpv", "coalesced duplicate load request")
            return
        }
        lastLoadSignature = loadSignature
        loaded = false
        fileLoadStarted = false
        initialVideoOutputReady = false
        ended = false
        errorMessage = null
        cachedTracks = emptyMap()
        cachedSnapshot = cachedSnapshot.copy(
            loading = true,
            buffering = false,
            playing = false,
            positionMs = 0L,
            durationMs = 0L,
            videoWidth = 0,
            videoHeight = 0,
            ended = false,
            firstFrameRendered = false,
            error = null,
            playbackSpeed = currentPlaybackSpeed,
        )
        trackCacheRefreshRequested = true
        Log.d(
            "ConduitMpv",
            "load requested surfaceReady=$surfaceReady subtitles=${subtitles.size} playWhenReady=$playWhenReady startMs=$currentStartPositionMs",
        )
        synchronized(nativeLock) {
            if (destroyed || !mpv.isInitialized) return
            loadGeneration += 1
            pendingLoadRequest = MpvLoadRequest(
                generation = loadGeneration,
                url = url,
                requestHeaders = requestHeaders,
                subtitles = subtitles,
                startPositionMs = currentStartPositionMs,
                playWhenReady = playWhenReady,
                preferredAudioLanguage = preferredAudioLanguage,
                preferredSubtitleLanguage = preferredSubtitleLanguage,
                playbackSpeed = currentPlaybackSpeed,
                subtitlesEnabled = subtitlesEnabled,
            )
        }
        enqueueNative { loadPendingSourceNative() }
    }

    fun retry(
        selectedSubtitleId: String? = currentSelectedSubtitleId,
        selectedSubtitleLanguage: String? = currentSelectedSubtitleLanguage,
        selectedSubtitleLabel: String? = currentSelectedSubtitleLabel,
        subtitlesEnabled: Boolean = currentSubtitlesEnabled,
    ) {
        currentSelectedSubtitleId = selectedSubtitleId
        currentSelectedSubtitleLanguage = selectedSubtitleLanguage
        currentSelectedSubtitleLabel = selectedSubtitleLabel
        currentSubtitlesEnabled = subtitlesEnabled
        lastLoadSignature = null
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
                selectedSubtitleLanguage = selectedSubtitleLanguage,
                selectedSubtitleLabel = selectedSubtitleLabel,
                subtitlesEnabled = subtitlesEnabled,
            )
        }
    }

    fun resumePositionMs(): Long = fallbackPositionMs(snapshot().positionMs, currentStartPositionMs)

    fun playWhenReady(): Boolean = currentPlayWhenReady

    fun setPaused(paused: Boolean) {
        currentPlayWhenReady = !paused
        if (cachedSnapshot.firstFrameRendered) {
            cachedSnapshot = cachedSnapshot.copy(playing = !paused, buffering = false)
        }
        if (!paused && !initialVideoOutputReady) {
            Log.d("ConduitMpv", "defer pause=false until initial video output")
            return
        }
        Log.d("ConduitMpv", "queue pause=$paused")
        enqueueNative {
            Log.d("ConduitMpv", "apply pause=$paused")
            setPausedNative(paused)
        }
    }

    fun seekTo(positionMs: Long) {
        enqueueNative {
            mpv.command("seek", (positionMs.coerceAtLeast(0) / 1000.0).toString(), "absolute")
        }
    }

    fun seekBy(offsetMs: Long) {
        enqueueNative { mpv.command("seek", (offsetMs / 1000.0).toString(), "relative") }
    }

    fun setPlaybackSpeed(speed: Float) {
        currentPlaybackSpeed = speed.coerceIn(0.25f, 4f)
        cachedSnapshot = cachedSnapshot.copy(playbackSpeed = currentPlaybackSpeed)
        Log.d("ConduitMpv", "queue speed=$currentPlaybackSpeed")
        enqueueNative {
            Log.d("ConduitMpv", "apply speed=$currentPlaybackSpeed")
            setPlaybackSpeedNative(currentPlaybackSpeed)
        }
    }

    fun playbackSpeed(): Float = currentPlaybackSpeed

    fun applyResizeMode(mode: Int) {
        if (lastResizeMode == mode) return
        lastResizeMode = mode
        val panscan = when (mode) {
            ANDROID_RESIZE_MODE_ZOOM -> 0.5
            androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> 1.0
            else -> 0.0
        }
        enqueueNative {
            mpv.setPropertyDouble("panscan", panscan)
            mpv.setPropertyString("video-aspect-override", "no")
        }
    }

    fun tracks(type: String): List<MpvTrack> {
        val loadedTracks = cachedTracks[type].orEmpty()
        if (type != "sub") return loadedTracks

        val loadedKeys = loadedTracks.mapNotNull(MpvTrack::selectionKey).toSet()
        val hasSelectedLoadedTrack = loadedTracks.any(MpvTrack::selected)
        val defaultExternalIndex = preferredExternalSubtitleIndex()
        val pendingTracks = currentSubtitles.mapIndexedNotNull { index, subtitle ->
            val key = subtitleSelectionKey(subtitle)
            if (key in loadedKeys) return@mapIndexedNotNull null
            MpvTrack(
                id = -1 - index,
                type = "sub",
                label = subtitle.addonName?.takeIf(String::isNotBlank)
                    ?: subtitle.url.substringAfterLast('/').substringBefore('?').ifBlank { "Add-on subtitle" },
                language = subtitle.lang,
                selectionKey = key,
                selected = currentSubtitlesEnabled && !hasSelectedLoadedTrack &&
                    (key == currentSelectedSubtitleId || (currentSelectedSubtitleId == null && index == defaultExternalIndex)),
                forced = false,
            )
        }
        return loadedTracks + pendingTracks
    }

    private fun refreshTrackCacheNative() {
        val tracks = mpv.getPropertyNode("track-list")
            ?.asArray()
            ?.mapNotNull { node ->
                val type = node.nodeString("type") ?: return@mapNotNull null
                val id = node.nodeInt("id") ?: return@mapNotNull null
                val externalFilename = node.nodeString("external-filename")
                val label = node.nodeString("title")
                    ?: externalFilename?.substringAfterLast('/')
                    ?: node.nodeString("codec")
                    ?: "Track $id"
                val language = node.nodeString("lang") ?: languageFromLabel(label)
                val forced = node.nodeBoolean("forced") ?: false
                MpvTrack(
                    id = id,
                    type = type,
                    label = label,
                    language = language,
                    selectionKey = externalFilename
                        ?.let { filename ->
                            currentSubtitles.firstOrNull { subtitle ->
                                subtitle.url == filename ||
                                    subtitle.url.substringBefore('#') == filename.substringBefore('#')
                            }
                        }
                        ?.let(::subtitleSelectionKey)
                        ?: embeddedSubtitleSelectionKey(
                            id = id,
                            sourceId = node.nodeInt("src-id"),
                            language = language,
                            label = label,
                            codec = node.nodeString("codec"),
                            forced = forced,
                        ),
                    selected = node.nodeBoolean("selected") ?: false,
                    forced = forced,
                )
            }
            .orEmpty()
        val nextTracks = tracks.groupBy(MpvTrack::type)
        if (nextTracks != cachedTracks) {
            trackRevision += 1
            Log.d(
                "ConduitMpv",
                "track cache audio=${nextTracks["audio"].orEmpty().size} subtitles=${nextTracks["sub"].orEmpty().size}",
            )
        }
        cachedTracks = nextTracks
        trackCacheRefreshRequested = false
    }

    fun selectAudio(trackId: Int?) {
        enqueueNative {
            if (trackId == null) mpv.setPropertyString("aid", "no") else mpv.setPropertyInt("aid", trackId)
        }
    }

    fun selectSubtitle(trackId: Int?, selectionKey: String?, subtitlesEnabled: Boolean) {
        currentSelectedSubtitleId = selectionKey
        currentSubtitlesEnabled = subtitlesEnabled
        enqueueNative {
            if (trackId == null) {
                mpv.setPropertyString("sid", "no")
            } else if (trackId < 0 && selectionKey != null) {
                currentSubtitles.firstOrNull { subtitleSelectionKey(it) == selectionKey }?.let { subtitle ->
                    mpv.command(
                        "sub-add",
                        subtitle.url,
                        "select",
                        subtitle.addonName.orEmpty(),
                        subtitle.lang.orEmpty(),
                    )
                    trackCacheRefreshRequested = true
                }
            } else {
                selectSingleSubtitleNative(trackId)
            }
        }
    }

    private fun selectSingleSubtitleNative(trackId: Int) {
        mpv.setPropertyString("sid", "no")
        mpv.setPropertyInt("sid", trackId)
    }

    private fun applyPendingSubtitleSelectionNative() {
        if (!currentSubtitlesEnabled) {
            if (cachedTracks["sub"].orEmpty().any { it.selected }) {
                runCatching { mpv.setPropertyString("sid", "no") }
            }
            return
        }
        if (currentSelectedSubtitleId == null &&
            currentSelectedSubtitleLanguage == null &&
            currentSelectedSubtitleLabel == null
        ) return
        val subtitleTracks = cachedTracks["sub"].orEmpty()
        val selectedTrack = currentSelectedSubtitleId
            ?.let { selectionKey -> subtitleTracks.firstOrNull { it.selectionKey == selectionKey } }
            ?: subtitleTracks.firstOrNull { track ->
                currentSelectedSubtitleLabel != null && track.label == currentSelectedSubtitleLabel
            }
            ?: subtitleTracks.firstOrNull { track ->
                sameSubtitleLanguage(track.language, currentSelectedSubtitleLanguage)
            }
            ?: return
        if (!selectedTrack.selected || subtitleTracks.count(MpvTrack::selected) != 1) {
            runCatching { selectSingleSubtitleNative(selectedTrack.id) }
        }
    }

    /** Match iOS/desktop: prefer an embedded track in the configured language. */
    private fun applyPreferredSubtitleSelectionNative() {
        if (!currentSubtitlesEnabled || preferredSubtitleApplied) return
        if (currentSelectedSubtitleId != null ||
            currentSelectedSubtitleLanguage != null ||
            currentSelectedSubtitleLabel != null
        ) return
        val preferred = mpvLanguageCode(currentPreferredSubtitle) ?: return
        val matchingTracks = cachedTracks["sub"].orEmpty().filter { track ->
            sameSubtitleLanguage(track.language, preferred) ||
                sameSubtitleLanguage(languageFromLabel(track.label), preferred)
        }
        val selectedTrack = matchingTracks.firstOrNull { it.selectionKey?.startsWith(EmbeddedSubtitleSelectionPrefix) == true }
            ?: matchingTracks.firstOrNull()
            ?: return
        preferredSubtitleApplied = true
        if (!selectedTrack.selected || cachedTracks["sub"].orEmpty().count(MpvTrack::selected) != 1) {
            runCatching { selectSingleSubtitleNative(selectedTrack.id) }
        }
    }

    private fun loadPendingSourceNative() {
        if (!surfaceReady) {
            Log.d("ConduitMpv", "load deferred: surface not ready")
            return
        }
        val request = pendingLoadRequest ?: run {
            Log.d("ConduitMpv", "surface ready with no pending load")
            return
        }
        Log.d(
            "ConduitMpv",
            "loadfile generation=${request.generation} subtitles=${request.subtitles.size} startMs=${request.startPositionMs}",
        )
        pendingLoadRequest = null
        activeLoadGeneration = request.generation
        pendingExternalSubtitles = request.subtitles
        externalSubtitleLoadQueued = false
        fileLoadStarted = false
        initialVideoOutputReady = false
        applyRequestHeaders(request.requestHeaders)
        setPreferredAudioLanguage(request.preferredAudioLanguage)
        setPlaybackSpeedNative(request.playbackSpeed)
        // Keep both audio and video paused until the first video output is
        // available. Without this, mpv can start audio while MediaCodec is
        // still retrying video initialization.
        setPausedNative(true)
        // mpv >= 0.38 added a playlist index argument before per-file options.
        // The options must remain one comma-separated argument, matching the
        // iOS bridge. Passing each option as its own argument can prevent the
        // load command from starting at all.
        val fileOptions = buildList {
            add("pause=yes")
            if (request.startPositionMs > 0) add("start=${request.startPositionMs / 1000.0}")
        }.joinToString(",")
        mpv.command("loadfile", request.url, "replace", "-1", fileOptions)
        // Keep mpv's automatic subtitle selection from racing the explicit
        // embedded-first choice made after track-list becomes available.
        mpv.setPropertyString("sid", "no")
        trackCacheRefreshRequested = true
        applyPendingSubtitleSelectionNative()
    }

    /** Returns the last background-refreshed state without touching JNI. */
    fun snapshot(): MpvPlaybackSnapshot = cachedSnapshot

    /** Schedules a non-blocking state refresh and returns the latest cached snapshot. */
    fun refreshSnapshot(): MpvPlaybackSnapshot {
        val shouldQueueRefresh = synchronized(nativeLock) {
            if (destroyed || !mpv.isInitialized || snapshotRefreshQueued) {
                false
            } else {
                snapshotRefreshQueued = true
                true
            }
        }
        if (shouldQueueRefresh) {
            nativeScope.launch {
                synchronized(nativeLock) {
                    try {
                        if (destroyed || !mpv.isInitialized) return@synchronized
                        refreshSnapshotNative()
                    } finally {
                        snapshotRefreshQueued = false
                    }
                }
            }
        }
        return cachedSnapshot
    }

    private fun refreshSnapshotNative() {
        val snapshot = runCatching {
            if (trackCacheRefreshRequested) refreshTrackCacheNative()
            applyPendingSubtitleSelectionNative()
            applyPreferredSubtitleSelectionNative()

            val paused = mpv.getPropertyBoolean("pause") ?: true
            val pausedForCache = mpv.getPropertyBoolean("paused-for-cache") ?: false
            val idle = mpv.getPropertyBoolean("core-idle") ?: false
            val seeking = mpv.getPropertyBoolean("seeking") ?: false
            val cacheState = mpv.getPropertyInt("cache-buffering-state")
            val durationMs = mpv.getPropertyDouble("duration").toMillis()
            val positionMs = mpv.getPropertyDouble("time-pos").toMillis()
            val speed = mpv.getPropertyDouble("speed")?.toFloat()?.takeIf { it.isFinite() } ?: currentPlaybackSpeed
            currentPlaybackSpeed = speed
            val width = mpv.getPropertyInt("video-out-params/dw")
                ?: mpv.getPropertyInt("video-params/dw")
                ?: 0
            val height = mpv.getPropertyInt("video-out-params/dh")
                ?: mpv.getPropertyInt("video-params/dh")
                ?: 0
            // Dimensions can be available while the decoder is still preparing
            // its first frame. Match the iOS bridge's stronger output check so
            // audio cannot resume against a still-black video surface.
            val hasInitialVideoOutput = !mpv.getPropertyString("video-frame-info/picture-type").isNullOrBlank() ||
                !mpv.getPropertyString("video-out-params/pixelformat").isNullOrBlank()
            val rendered = loaded && width > 0 && height > 0 && hasInitialVideoOutput
            if (rendered && !initialVideoOutputReady) {
                initialVideoOutputReady = true
                if (currentPlayWhenReady) {
                    Log.d("ConduitMpv", "initial video output ready; resuming playback")
                    setPausedNative(false)
                }
                queueExternalSubtitlesNative(activeLoadGeneration)
            }
            val buffering = loaded && !rendered && (pausedForCache || cacheState?.let { it in 0 until 100 } == true)
            MpvPlaybackSnapshot(
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
                playbackSpeed = speed,
            )
        }.getOrElse {
            cachedSnapshot.copy(
                error = errorMessage ?: "libmpv could not be initialized on this device.",
                trackRevision = trackRevision,
                playbackSpeed = currentPlaybackSpeed,
            )
        }
        cachedSnapshot = snapshot
    }

    private fun queueExternalSubtitlesNative(generation: Long) {
        val subtitles = pendingExternalSubtitles
        if (subtitles.isEmpty() || externalSubtitleLoadQueued) return
        externalSubtitleLoadQueued = true
        pendingExternalSubtitles = emptyList()
        val selectedIndex = preferredExternalSubtitleIndex()
        Log.d("ConduitMpv", "external subtitle load started count=${subtitles.size} selectedIndex=$selectedIndex")
        subtitleScope.launch {
            subtitles.forEachIndexed { index, subtitle ->
                if (destroyed || generation != activeLoadGeneration) return@launch
                runCatching {
                    mpv.command(
                        "sub-add",
                        subtitle.url,
                        // mpv's `cached` flag selects the added subtitle. Use
                        // `auto` for alternatives so loading them cannot
                        // replace the user's current subtitle.
                        if (index == selectedIndex) "select" else "auto",
                        subtitle.addonName.orEmpty(),
                        subtitle.lang.orEmpty(),
                    )
                }
            }
            synchronized(nativeLock) {
                if (generation == activeLoadGeneration) {
                    trackCacheRefreshRequested = true
                    externalSubtitleLoadQueued = false
                    Log.d("ConduitMpv", "external subtitle load finished count=${subtitles.size}")
                }
            }
        }
    }

    private fun preferredExternalSubtitleIndex(): Int? {
        if (!currentSubtitlesEnabled || currentSubtitles.isEmpty()) return null
        return currentSubtitles.indexOfFirst { subtitleSelectionKey(it) == currentSelectedSubtitleId }
            .takeIf { it >= 0 }
            ?: if (currentSelectedSubtitleId != null || currentSelectedSubtitleLanguage != null || currentSelectedSubtitleLabel != null) {
                null
            } else {
                if (hasPreferredEmbeddedSubtitle()) return null
                val preferred = mpvLanguageCode(currentPreferredSubtitle)
                preferred?.let { code ->
                    currentSubtitles.indexOfFirst { subtitle ->
                        subtitle.lang?.substringBefore('-')?.substringBefore('_') == code
                    }.takeIf { it >= 0 }
                } ?: currentSubtitles.indices.firstOrNull()
            }
    }

    private fun hasPreferredEmbeddedSubtitle(): Boolean {
        val preferred = mpvLanguageCode(currentPreferredSubtitle) ?: return false
        return cachedTracks["sub"].orEmpty().any { track ->
            track.selectionKey?.startsWith(EmbeddedSubtitleSelectionPrefix) == true &&
                (sameSubtitleLanguage(track.language, preferred) ||
                    sameSubtitleLanguage(languageFromLabel(track.label), preferred))
        }
    }

    private fun setPausedNative(paused: Boolean) {
        runCatching { mpv.setPropertyBoolean("pause", paused) }
    }

    private fun setPlaybackSpeedNative(speed: Float) {
        runCatching { mpv.setPropertyDouble("speed", speed.toDouble()) }
    }

    private fun enqueueNative(block: () -> Unit) {
        nativeScope.launch {
            synchronized(nativeLock) {
                if (!destroyed && mpv.isInitialized) runCatching(block)
            }
        }
    }

    fun destroySafely() {
        synchronized(nativeLock) {
            if (destroyed) return
            destroyed = true
        }
        subtitleScope.cancel()
        nativeScope.launch {
            synchronized(nativeLock) {
                runCatching { destroy() }
            }
            nativeScope.cancel()
        }
    }

    override fun surfaceCreated(holder: android.view.SurfaceHolder) {
        nativeScope.launch {
            synchronized(nativeLock) {
                if (!destroyed) {
                    surfaceReady = false
                    runCatching {
                        super.surfaceCreated(holder)
                        Log.d("ConduitMpv", "libmpv surface attached")
                    }.onFailure {
                        surfaceReady = false
                        Log.e("ConduitMpv", "Failed to attach libmpv surface", it)
                    }
                }
            }
        }
    }

    override fun surfaceChanged(holder: android.view.SurfaceHolder, format: Int, width: Int, height: Int) {
        nativeScope.launch {
            synchronized(nativeLock) {
                if (!destroyed) {
                    runCatching {
                        super.surfaceChanged(holder, format, width, height)
                        surfaceReady = width > 0 && height > 0
                        if (surfaceReady) {
                            Log.d("ConduitMpv", "libmpv surface ready: ${width}x$height")
                            loadPendingSourceNative()
                        }
                    }.onFailure {
                        surfaceReady = false
                        Log.e("ConduitMpv", "Failed to configure libmpv surface", it)
                    }
                }
            }
        }
    }

    override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
        nativeScope.launch {
            synchronized(nativeLock) {
                if (!destroyed) {
                    surfaceReady = false
                    runCatching {
                        super.surfaceDestroyed(holder)
                        Log.d("ConduitMpv", "libmpv surface detached")
                    }.onFailure {
                        Log.e("ConduitMpv", "Failed to detach libmpv surface", it)
                    }
                }
            }
        }
    }

    private fun setPreferredAudioLanguage(audio: String) {
        mpvLanguageCode(audio)?.let { mpv.setPropertyString("alang", it) }
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

private fun sameSubtitleLanguage(first: String?, second: String?): Boolean {
    val normalize = { language: String? ->
        language
            ?.replace('_', '-')
            ?.substringBefore('-')
            ?.lowercase()
            ?.takeIf(String::isNotBlank)
    }
    return normalize(first) != null && normalize(first) == normalize(second)
}

private fun embeddedSubtitleSelectionKey(
    id: Int,
    sourceId: Int?,
    language: String?,
    label: String,
    codec: String?,
    forced: Boolean,
): String = listOf(
    EmbeddedSubtitleSelectionPrefix,
    sourceId ?: id,
    language.orEmpty(),
    label,
    codec.orEmpty(),
    forced,
).joinToString("|")

internal fun subtitleSelectionKey(subtitle: SubtitleItem): String = subtitle.id ?: subtitle.url
