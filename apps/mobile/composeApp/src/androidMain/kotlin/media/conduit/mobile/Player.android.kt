package media.conduit.mobile

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.SystemClock
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.compose.runtime.*
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView
import androidx.media3.ui.AspectRatioFrameLayout
import kotlinx.coroutines.delay
import media.conduit.mobile.account.SubtitleItem
import android.net.Uri

private const val ANDROID_RESIZE_MODE_ZOOM = -1

@Composable
actual fun PlayerOrientationLock(active: Boolean) {
    val activity = androidx.compose.ui.platform.LocalContext.current as? Activity
    DisposableEffect(activity, active) {
        if (active) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose {
            if (active) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    presentation: PlaybackPresentation,
    command: SequencedPlaybackCommand?,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    subtitles: List<SubtitleItem>,
    contentLogo: String?,
    contentTitle: String?,
    hasNextEpisode: Boolean,
    onNextEpisode: () -> Unit,
    hasEpisodes: Boolean,
    touchGestures: Boolean,
    holdToSpeed: Boolean,
    preferredAudioLanguage: String,
    preferredSubtitleLanguage: String,
    onEpisodes: () -> Unit,
    onControlsVisibilityChanged: (Boolean) -> Unit,
    onTemporarySpeedChanged: (Boolean) -> Unit,
    onSystemPipChanged: (Boolean) -> Unit,
    onSystemPipAvailabilityChanged: (Boolean) -> Unit,
    interactiveResize: Boolean,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val activity = context as? Activity
    val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val windowSize = LocalWindowInfo.current.containerSize
    val isTablet = with(LocalDensity.current) {
        windowSize.width.toDp() >= 600.dp || windowSize.height.toDp() >= 600.dp
    }
    val currentCallback by rememberUpdatedState(onState)
    val latestTemporarySpeedCallback by rememberUpdatedState(onTemporarySpeedChanged)
    val latestPipCallback by rememberUpdatedState(onSystemPipChanged)
    val latestPipAvailabilityCallback by rememberUpdatedState(onSystemPipAvailabilityChanged)
    val player = remember(url, requestHeaders, subtitles) {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("conduit Mobile")
            .setDefaultRequestProperties(requestHeaders)
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        ExoPlayer.Builder(context, renderers).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build()
    }
    var playbackError by remember(player) { mutableStateOf<String?>(null) }
    var controlsVisible by remember(player) { mutableStateOf(true) }
    var speedMenuOpen by remember(player) { mutableStateOf(false) }
    LaunchedEffect(controlsVisible) { onControlsVisibilityChanged(controlsVisible) }
    var positionMs by remember(player) { mutableLongStateOf(0L) }
    var durationMs by remember(player) { mutableLongStateOf(0L) }
    var playing by remember(player) { mutableStateOf(false) }
    var playbackSpeed by remember(player) { mutableFloatStateOf(1f) }
    var initialLoadComplete by remember(player) { mutableStateOf(false) }
    var firstFrameRendered by remember(player) { mutableStateOf(false) }
    var buffering by remember(player) { mutableStateOf(false) }
    var dragging by remember(player) { mutableStateOf(false) }
    var draggedPosition by remember(player) { mutableFloatStateOf(0f) }
    var trackPanel by remember { mutableStateOf<Int?>(null) }
    var tracksRevision by remember { mutableIntStateOf(0) }
    var trackFallback by remember(player) { mutableStateOf<androidx.media3.common.TrackSelectionParameters?>(null) }
    var lastTrackChangeAt by remember(player) { mutableLongStateOf(0L) }
    var autoAudioSelection by remember(player) { mutableStateOf<String?>(null) }
    var resizeMode by remember(player) { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }
    var showRemainingTime by remember(player) { mutableStateOf(false) }
    val preferredAudioCode = remember(preferredAudioLanguage) { audioLanguageCode(preferredAudioLanguage) }

    DisposableEffect(player, url) {
        var resumed = false
        val listener = object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                val fallback = trackFallback
                if (fallback != null && SystemClock.elapsedRealtime() - lastTrackChangeAt < 8_000) {
                    val restorePosition = player.currentPosition.coerceAtLeast(0)
                    player.trackSelectionParameters = fallback
                    trackFallback = null
                    playbackError = null
                    player.prepare()
                    player.seekTo(restorePosition)
                    player.play()
                    Toast.makeText(context, "That track is not supported on this device. Restored the previous audio selection.", Toast.LENGTH_LONG).show()
                    return
                }
                player.pause()
                playbackError = when (error.errorCode) {
                    androidx.media3.common.PlaybackException.ERROR_CODE_DECODING_FAILED,
                    androidx.media3.common.PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
                    -> "This device cannot decode this stream's video format. Try a 1080p H.264/AVC stream or a physical device with HEVC support."
                    else -> error.cause?.message ?: error.message
                }
            }
            override fun onTracksChanged(tracks: Tracks) {
                tracksRevision++
                val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                if (audio.isNotEmpty() && audio.none { group -> (0 until group.length).any(group::isTrackSupported) }) {
                    player.pause()
                    playbackError = "None of this stream's audio formats can be decoded by this device. Choose another stream for working audio."
                } else {
                    val candidates = audio.flatMap { group -> (0 until group.length).filter(group::isTrackSupported).map { index -> group to index } }
                    val best = candidates.maxByOrNull { (group, index) -> audioTrackScore(group.getTrackFormat(index), preferredAudioCode) }
                    val selected = candidates.firstOrNull { (group, index) -> group.isTrackSelected(index) }
                    if (best != null && audioTrackScore(best.first.getTrackFormat(best.second), preferredAudioCode) > (selected?.let { audioTrackScore(it.first.getTrackFormat(it.second), preferredAudioCode) } ?: Int.MIN_VALUE)) {
                        val key = "${best.first.mediaTrackGroup.id}:${best.second}"
                        if (autoAudioSelection != key) {
                            autoAudioSelection = key
                            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO).addOverride(TrackSelectionOverride(best.first.mediaTrackGroup, best.second)).build()
                        }
                    }
                }
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && !resumed) {
                    resumed = true
                    initialLoadComplete = true
                    val duration = player.duration.coerceAtLeast(0)
                    if (startPositionMs > 0 && startPositionMs < duration - 5_000) player.seekTo(startPositionMs)
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                (activity as? MainActivity)?.updateConduitPictureInPictureParams()
            }
            override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
                (activity as? MainActivity)?.updateConduitPipVideoSize(videoSize.width, videoSize.height)
            }
            override fun onRenderedFirstFrame() {
                firstFrameRendered = true
            }
        }
        player.addListener(listener)
        if (url != null) {
            val item = MediaItem.Builder().setUri(url).apply {
                val lower = url.lowercase().substringBefore('#')
                when {
                    ".m3u8" in lower || "format=m3u8" in lower -> setMimeType(MimeTypes.APPLICATION_M3U8)
                    ".mpd" in lower || "format=mpd" in lower -> setMimeType(MimeTypes.APPLICATION_MPD)
                    ".ism" in lower || ".isml" in lower -> setMimeType(MimeTypes.APPLICATION_SS)
                }
                setSubtitleConfigurations(subtitles.map { subtitle ->
                    val lower = subtitle.url.substringBefore('?').lowercase()
                    val mime = when { lower.endsWith(".vtt") -> MimeTypes.TEXT_VTT; lower.endsWith(".ass") || lower.endsWith(".ssa") -> MimeTypes.TEXT_SSA; lower.endsWith(".ttml") || lower.endsWith(".xml") -> MimeTypes.APPLICATION_TTML; else -> MimeTypes.APPLICATION_SUBRIP }
                    val language = subtitle.lang?.let { java.util.Locale.forLanguageTag(it.replace('_', '-')).displayLanguage } ?: "Subtitle"
                    MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitle.url)).setMimeType(mime).setLanguage(subtitle.lang).setLabel("$language · ${subtitle.addonName ?: "Add-on"}").build()
                })
            }.build()
            player.setMediaItem(item)
            preferredAudioCode?.let { code -> player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setPreferredAudioLanguages(code).build() }
            player.prepare()
            player.playWhenReady = active
        }
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }
    DisposableEffect(player, activity) {
        val mainActivity = activity as? MainActivity
        mainActivity?.attachConduitPipPlayer(player) { latestPipCallback(it) }
        onDispose { mainActivity?.detachConduitPipPlayer(player) }
    }
    LaunchedEffect(activity) {
        latestPipAvailabilityCallback(
            android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O &&
                context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE),
        )
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && activity?.isInPictureInPictureMode != true) player.pause()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(player, command?.sequence) {
        when (val next = command?.command) {
            PlaybackCommand.Play -> player.play()
            PlaybackCommand.Pause -> player.pause()
            is PlaybackCommand.SeekTo -> player.seekTo(next.positionMs.coerceAtLeast(0))
            PlaybackCommand.EnterSystemPip -> (activity as? MainActivity)?.enterConduitPictureInPicture()
            PlaybackCommand.RetryVideoOutput -> player.play()
            null -> Unit
        }
    }
    LaunchedEffect(presentation) {
        controlsVisible = presentation == PlaybackPresentation.FullScreen
    }
    LaunchedEffect(player, lifecycle, landscape) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                val isBuffering = initialLoadComplete && player.playbackState == Player.STATE_BUFFERING
                val playerPipReady = landscape &&
                    initialLoadComplete &&
                    firstFrameRendered &&
                    player.duration > 0 &&
                    playbackError == null
                currentCallback(
                    PlaybackState(
                        loading = !initialLoadComplete,
                        buffering = isBuffering,
                        playing = player.isPlaying,
                        positionMs = player.currentPosition.coerceAtLeast(0),
                        durationMs = player.duration.coerceAtLeast(0),
                        videoWidth = player.videoSize.width,
                        videoHeight = player.videoSize.height,
                        ended = player.playbackState == Player.STATE_ENDED,
                        error = playbackError,
                        pipReady = playerPipReady,
                    ),
                )
                if (!dragging) positionMs = player.currentPosition.coerceAtLeast(0)
                durationMs = player.duration.coerceAtLeast(0)
                playing = player.isPlaying
                buffering = isBuffering
                playbackSpeed = player.playbackParameters.speed
                (activity as? MainActivity)?.updateConduitPipReadiness(playerPipReady)
                delay(500)
            }
        }
    }
    LaunchedEffect(controlsVisible, playing, speedMenuOpen) {
        if (controlsVisible && playing && !speedMenuOpen) {
            delay(4_000)
            controlsVisible = false
        }
    }

    val holdToSpeedReady = firstFrameRendered && durationMs > 0
    val doubleTapSlopPx = with(LocalDensity.current) { 48.dp.toPx() }
    Box(modifier.background(Color.Black).pointerInput(player, resizeMode) { detectTransformGestures { _, _, zoom, _ ->
        val next = when { zoom > 1.04f -> ANDROID_RESIZE_MODE_ZOOM; zoom < .96f -> AspectRatioFrameLayout.RESIZE_MODE_FIT; else -> resizeMode }
        if (next != resizeMode) resizeMode = next
    } }.pointerInput(player, touchGestures, holdToSpeed, holdToSpeedReady, controlsVisible) {
        detectMovementTolerantPlayerGestures(
            touchGestures = touchGestures,
            holdToSpeed = holdToSpeed,
            holdToSpeedReady = holdToSpeedReady,
            doubleTapSlopPx = doubleTapSlopPx,
            currentSpeed = { player.playbackParameters.speed },
            setSpeed = player::setPlaybackSpeed,
            onTemporarySpeedChanged = latestTemporarySpeedCallback,
            onTap = { controlsVisible = true },
            onDoubleTap = { offset ->
                if (offset.x < size.width / 2f) player.seekBack() else player.seekForward()
                controlsVisible = true
            },
        )
    }) {
        AndroidView(
            factory = { PlayerView(it).apply { this.player = player; useController = false; setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER); keepScreenOn = true; (activity as? MainActivity)?.setConduitPipSourceView(this) } },
            update = {
                it.player = player
                it.resizeMode = if (resizeMode == ANDROID_RESIZE_MODE_ZOOM) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else resizeMode
                val scale = if (resizeMode == ANDROID_RESIZE_MODE_ZOOM) 1.15f else 1f
                it.scaleX = scale
                it.scaleY = scale
                it.subtitleView?.setFractionalTextSize(
                    if (presentation == PlaybackPresentation.FullScreen) .0533f else .035f,
                )
                (activity as? MainActivity)?.setConduitPipSourceView(it)
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (controlsVisible && presentation == PlaybackPresentation.FullScreen) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .42f)).pointerInput(player, resizeMode) { detectTransformGestures { _, _, zoom, _ ->
                val next = when { zoom > 1.04f -> ANDROID_RESIZE_MODE_ZOOM; zoom < .96f -> AspectRatioFrameLayout.RESIZE_MODE_FIT; else -> resizeMode }
                if (next != resizeMode) resizeMode = next
            } }.pointerInput(player, touchGestures, holdToSpeed, holdToSpeedReady) {
                detectMovementTolerantPlayerGestures(
                    touchGestures = touchGestures,
                    holdToSpeed = holdToSpeed,
                    holdToSpeedReady = holdToSpeedReady,
                    doubleTapSlopPx = doubleTapSlopPx,
                    currentSpeed = { player.playbackParameters.speed },
                    setSpeed = player::setPlaybackSpeed,
                    onTemporarySpeedChanged = latestTemporarySpeedCallback,
                    onTap = { controlsVisible = false },
                    onDoubleTap = { offset ->
                        if (offset.x < size.width / 2f) player.seekBack() else player.seekForward()
                        controlsVisible = true
                    },
                )
            }) {
                val loadingOrPortrait = !landscape || durationMs <= 0
                Box(Modifier.fillMaxSize()) {
                    if (shouldShowCenterPlaybackControl(controlsVisible, dragging, buffering)) {
                        FilledIconButton(onClick = { if (player.isPlaying) player.pause() else player.play(); controlsVisible = true }, modifier = Modifier.align(Alignment.Center).size(64.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White, contentColor = Color.Black)) {
                            Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause" else "Play", modifier = Modifier.size(38.dp))
                        }
                    }
                    if (hasNextEpisode) {
                        FilledIconButton(
                            onClick = { onNextEpisode(); controlsVisible = true },
                            modifier = Modifier.align(Alignment.Center).offset(x = 70.dp).size(52.dp),
                            colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.Black.copy(alpha = .72f), contentColor = Color.White),
                        ) {
                            Icon(Icons.Rounded.SkipNext, "Next episode", modifier = Modifier.size(30.dp))
                        }
                    }
                }
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = if (loadingOrPortrait) 66.dp else 14.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    Slider(
                        value = if (dragging) draggedPosition else positionMs.toFloat(),
                        onValueChange = { dragging = true; draggedPosition = it },
                        onValueChangeFinished = { player.seekTo(draggedPosition.toLong()); dragging = false; controlsVisible = true },
                        valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
                        colors = SliderDefaults.colors(thumbColor = MaterialTheme.colorScheme.primary, activeTrackColor = MaterialTheme.colorScheme.primary, inactiveTrackColor = Color.White.copy(.35f)), modifier = Modifier.height(30.dp),
                    )
                    val displayedPosition = if (dragging) draggedPosition.toLong() else positionMs
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        PlayerTimePill(formatPlayerTime(displayedPosition))
                        PlayerTimePill(
                            value = if (showRemainingTime) {
                                "-${formatPlayerTime((durationMs - displayedPosition).coerceAtLeast(0))}"
                            } else {
                                formatPlayerTime(durationMs)
                            },
                            onClick = {
                                showRemainingTime = !showRemainingTime
                                controlsVisible = true
                            },
                            contentDescription = if (showRemainingTime) {
                                "Time remaining. Tap to show end time."
                            } else {
                                "End time. Tap to show time remaining."
                            },
                        )
                    }
                    if (!loadingOrPortrait) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
                        val haptics = LocalHapticFeedback.current
                        val speeds = listOf(.5f, .75f, 1f, 1.25f, 1.5f, 2f)
                        Box {
                            PlayerBottomAction(
                                Icons.Rounded.Speed,
                                "$playbackSpeed×",
                                landscape,
                                onLongClick = {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    speedMenuOpen = true
                                    controlsVisible = true
                                },
                            ) {
                                val current = player.playbackParameters.speed
                                val index = speeds.indexOfFirst { it == current }.takeIf { it >= 0 } ?: 2
                                playbackSpeed = speeds[(index + 1) % speeds.size]
                                player.setPlaybackSpeed(playbackSpeed)
                                controlsVisible = true
                            }
                            DropdownMenu(
                                expanded = speedMenuOpen,
                                onDismissRequest = { speedMenuOpen = false },
                                modifier = Modifier.width(176.dp).background(Color(0xFF151518)),
                                shape = RoundedCornerShape(16.dp),
                                containerColor = Color(0xFF151518),
                                border = BorderStroke(1.dp, Color.White.copy(alpha = .16f)),
                                shadowElevation = 12.dp,
                            ) {
                                Text(
                                    "Playback speed",
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    color = Color.White.copy(alpha = .58f),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                speeds.forEach { speed ->
                                    val selected = speed == playbackSpeed
                                    DropdownMenuItem(
                                        modifier = Modifier.padding(horizontal = 6.dp).clip(RoundedCornerShape(10.dp)).background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .13f) else Color.Transparent),
                                        text = { Text("$speed×", color = if (selected) Color.White else Color.White.copy(alpha = .78f), fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal) },
                                        trailingIcon = if (selected) {{ Icon(Icons.Rounded.Check, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) }} else null,
                                        onClick = {
                                            player.setPlaybackSpeed(speed)
                                            playbackSpeed = speed
                                            speedMenuOpen = false
                                            controlsVisible = true
                                        },
                                    )
                                }
                            }
                        }
                        if (isTablet) PlayerBottomAction(Icons.Rounded.AspectRatio, androidResizeModeLabel(resizeMode), landscape) {
                            resizeMode = nextAndroidResizeMode(resizeMode)
                            controlsVisible = true
                        }
                        PlayerBottomAction(Icons.Rounded.Headphones, "Audio", landscape) { trackPanel = C.TRACK_TYPE_AUDIO; controlsVisible = true }
                        PlayerBottomAction(Icons.Rounded.Subtitles, "Subtitles", landscape) { trackPanel = C.TRACK_TYPE_TEXT; controlsVisible = true }
                        if (hasEpisodes) PlayerBottomAction(Icons.Rounded.PlaylistPlay, "Episodes", landscape, onClick = onEpisodes)
                    }
                }
                if (loadingOrPortrait && hasEpisodes) IconButton(onClick = onEpisodes, modifier = Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 8.dp).background(Color.Black.copy(.58f), CircleShape)) { Icon(Icons.Rounded.PlaylistPlay, "Episodes", tint = Color.White) }
            }
        }
        trackPanel?.let { type ->
            @Suppress("UNUSED_EXPRESSION") tracksRevision
            PlayerTrackPanel(player, type, onBeforeSelection = { trackFallback = player.trackSelectionParameters; lastTrackChangeAt = SystemClock.elapsedRealtime() }, onDismiss = { trackPanel = null })
        }
    }
}

private fun audioLanguageCode(preference: String): String? = when (preference) {
    "System default" -> java.util.Locale.getDefault().language.takeIf(String::isNotBlank)
    "English" -> "en"
    "Spanish" -> "es"
    "French" -> "fr"
    "German" -> "de"
    "Japanese" -> "ja"
    "Korean" -> "ko"
    else -> null
}

private fun audioTrackScore(format: androidx.media3.common.Format, preferredLanguage: String?): Int {
    val language = format.language?.let { java.util.Locale.forLanguageTag(it.replace('_', '-')).language }
    val label = format.label.orEmpty().lowercase()
    val commentary = format.roleFlags and C.ROLE_FLAG_COMMENTARY != 0 || "commentary" in label || "description" in label
    return (if (preferredLanguage != null && language == preferredLanguage) 1_000 else 0) +
        (if (!commentary) 200 else -500) +
        (if (format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0) 40 else 0) +
        (format.channelCount.takeIf { it > 0 } ?: 0)
}

private fun androidAudioLanguageName(format: androidx.media3.common.Format): String {
    format.language?.takeIf(String::isNotBlank)?.let { language ->
        return java.util.Locale.forLanguageTag(language.replace('_', '-'))
            .displayLanguage
            .replaceFirstChar(Char::uppercase)
    }
    val label = format.label?.substringBefore('(')?.substringBefore('[')?.trim()?.lowercase()
    val code = when (label) {
        "english" -> "en"
        "spanish", "español" -> "es"
        "german", "deutsch" -> "de"
        "french", "français" -> "fr"
        "hungarian", "magyar" -> "hu"
        "italian", "italiano" -> "it"
        "portuguese", "português" -> "pt"
        "japanese", "日本語" -> "ja"
        "korean", "한국어" -> "ko"
        "chinese", "中文" -> "zh"
        else -> null
    }
    return code?.let { java.util.Locale.forLanguageTag(it).displayLanguage.replaceFirstChar(Char::uppercase) }
        ?: "Unknown language"
}

@Composable
private fun PlayerTimePill(
    value: String,
    onClick: (() -> Unit)? = null,
    contentDescription: String? = null,
) {
    val interactionModifier = if (onClick != null) {
        Modifier
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription?.let { this.contentDescription = it } }
    } else {
        Modifier
    }
    Surface(modifier = interactionModifier, color = Color.Black.copy(.65f), shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(.22f))) {
        Text(value, color = Color.White, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp), style = MaterialTheme.typography.labelLarge)
    }
}

private fun nextAndroidResizeMode(mode: Int): Int = when (mode) {
    AspectRatioFrameLayout.RESIZE_MODE_FIT -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
    AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> ANDROID_RESIZE_MODE_ZOOM
    else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
}

private fun androidResizeModeLabel(mode: Int): String = when (mode) {
    AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> "Fill"
    ANDROID_RESIZE_MODE_ZOOM -> "Zoom"
    else -> "Fit"
}

@Composable
private fun BoxScope.PlayerTrackPanel(player: ExoPlayer, type: Int, onBeforeSelection: () -> Unit, onDismiss: () -> Unit) {
    val groups = player.currentTracks.groups.filter { it.type == type }
    val context = androidx.compose.ui.platform.LocalContext.current
    val options = groups.flatMap { group -> (0 until group.length).map { index -> PlayerTrackOption(group, index) } }
    val selectedOption = options.firstOrNull { it.group.isTrackSelected(it.index) }
    var subtitlePage by remember { mutableStateOf("overview") }
    var chosenLanguage by remember(selectedOption?.languageKey) { mutableStateOf(selectedOption?.languageKey ?: options.firstOrNull { it.supported }?.languageKey) }
    fun select(option: PlayerTrackOption, close: Boolean) {
        onBeforeSelection()
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(type, false).clearOverridesOfType(type).addOverride(TrackSelectionOverride(option.group.mediaTrackGroup, option.index)).build()
        chosenLanguage = option.languageKey
        if (close) onDismiss() else subtitlePage = "overview"
    }
    if (type == C.TRACK_TYPE_TEXT) {
        FullscreenSubtitlePanel(player, options, selectedOption, onBeforeSelection, onDismiss)
        return
    }
    Surface(modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(.48f), color = Color(0xF21A1A1D), shape = RoundedCornerShape(topStart = 28.dp, bottomStart = 28.dp), shadowElevation = 18.dp) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (type == C.TRACK_TYPE_TEXT && subtitlePage != "overview") IconButton(onClick = { subtitlePage = "overview" }) { Icon(Icons.Rounded.ArrowBack, "Back", tint = Color.White) }
                Text(if (type == C.TRACK_TYPE_AUDIO) "Audio" else when (subtitlePage) { "language" -> "Subtitle language"; "variant" -> "Subtitle variant"; else -> "Subtitles" }, color = Color.White, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.weight(1f)); IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
            }
            Text(if (type == C.TRACK_TYPE_AUDIO) "Choose an audio language" else when (subtitlePage) { "language" -> "A compatible variant is selected automatically"; "variant" -> "Override the selected variant"; else -> "Language, variant, and appearance" }, color = Color.White.copy(.6f))
            Spacer(Modifier.height(14.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (type == C.TRACK_TYPE_TEXT && subtitlePage == "overview") {
                    item { PlayerTrackRow("Off", selectedOption == null) { player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(type).setTrackTypeDisabled(type, true).build(); onDismiss() } }
                    item { PlayerTrackRow("Language  ·  ${selectedOption?.languageName ?: "Choose"}", false) { subtitlePage = "language" } }
                    item { PlayerTrackRow("Variant  ·  ${selectedOption?.variantName ?: "Automatic"}", false, selectedOption != null) { subtitlePage = "variant" } }
                    item { PlayerTrackRow("Subtitle settings  ·  Managed by Android", false) { Toast.makeText(context, "Subtitle appearance follows your Android caption preferences.", Toast.LENGTH_LONG).show() } }
                } else if (type == C.TRACK_TYPE_TEXT && subtitlePage == "language") {
                    options.distinctBy(PlayerTrackOption::languageKey).forEach { option ->
                        item(option.languageKey) { PlayerTrackRow(option.languageName, option.languageKey == selectedOption?.languageKey, option.supported) { select(options.firstOrNull { it.languageKey == option.languageKey && it.supported } ?: option, false) } }
                    }
                } else if (type == C.TRACK_TYPE_TEXT && subtitlePage == "variant") {
                    options.filter { it.languageKey == chosenLanguage }.forEach { option ->
                        item("${option.languageKey}:${option.index}:${option.group.mediaTrackGroup.id}") { PlayerTrackRow(listOf(option.variantName, if (!option.supported) "Unsupported on this device" else "").filter { it.isNotBlank() }.joinToString(" · "), option.selected, option.supported) { select(option, false) } }
                    }
                } else groups.forEach { group ->
                    items((0 until group.length).toList()) { index ->
                        val format = group.getTrackFormat(index)
                        val supported = group.isTrackSupported(index)
                        val display = audioTrackDisplay(
                            AudioTrackDisplayInfo(
                                title = format.label.orEmpty(),
                                languageCode = format.language,
                                languageName = androidAudioLanguageName(format),
                                codec = format.codecs ?: format.sampleMimeType,
                                channelCount = format.channelCount.takeIf { it > 0 },
                                sampleRate = format.sampleRate.takeIf { it > 0 },
                                bitrate = (format.averageBitrate.takeIf { it > 0 }
                                    ?: format.peakBitrate.takeIf { it > 0 })?.toLong(),
                            ),
                            fallback = "Audio track ${index + 1}",
                        )
                        PlayerAudioTrackRow(display, group.isTrackSelected(index), supported) {
                            select(PlayerTrackOption(group, index), true)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BoxScope.FullscreenSubtitlePanel(player: ExoPlayer, options: List<PlayerTrackOption>, selected: PlayerTrackOption?, onBeforeSelection: () -> Unit, onDismiss: () -> Unit) {
    var language by remember(selected?.languageKey) { mutableStateOf(selected?.languageKey ?: options.firstOrNull { it.supported }?.languageKey) }
    var selectedTrackKey by remember { mutableStateOf(selected?.key) }
    LaunchedEffect(selected?.key) { selectedTrackKey = selected?.key }
    fun choose(option: PlayerTrackOption) { onBeforeSelection(); language = option.languageKey; selectedTrackKey = option.key; player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).clearOverridesOfType(C.TRACK_TYPE_TEXT).addOverride(TrackSelectionOverride(option.group.mediaTrackGroup, option.index)).build() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 700.dp && maxHeight >= 500.dp
        if (expanded) Box(Modifier.fillMaxSize().background(Color.Black.copy(.52f)).clickable(onClick = onDismiss))
        Surface(
            modifier = if (expanded) {
                Modifier.align(Alignment.Center).fillMaxWidth(.9f).fillMaxHeight(.8f)
                    .widthIn(max = 1_100.dp).heightIn(max = 760.dp).clickable(onClick = {})
            } else Modifier.fillMaxSize(),
            color = Color(0xFA0D0C22),
            shape = if (expanded) RoundedCornerShape(24.dp) else RoundedCornerShape(0.dp),
            shadowElevation = if (expanded) 24.dp else 0.dp,
        ) {
          Box {
            Row(Modifier.fillMaxSize().padding(horizontal = 30.dp, vertical = 28.dp), horizontalArrangement = Arrangement.spacedBy(30.dp)) {
                Column(Modifier.weight(1f)) { Text("Subtitle Languages", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold); Spacer(Modifier.height(18.dp)); LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) { item { PlayerTrackRow("Disabled", selectedTrackKey == null) { selectedTrackKey = null; player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build() } }; options.distinctBy(PlayerTrackOption::languageKey).forEach { option -> item(option.languageKey) { PlayerTrackRow(option.languageName, selectedTrackKey != null && language == option.languageKey, option.supported) { val best = options.firstOrNull { it.languageKey == option.languageKey && it.supported } ?: option; choose(best) } } } } }
                Column(Modifier.weight(1f)) { Text("Subtitle Variants", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold); Spacer(Modifier.height(18.dp)); LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) { options.filter { it.languageKey == language }.forEach { option -> item(option.key) { PlayerTrackRow(option.variantName, option.key == selectedTrackKey, option.supported) { choose(option) } } } } }
                Column(Modifier.weight(1f)) { Text("Subtitle Settings", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold); Spacer(Modifier.weight(1f)); Text("Subtitle appearance follows Android system settings. Change it under Accessibility → Caption preferences for consistent styling across apps.", color = Color.White.copy(.72f), style = MaterialTheme.typography.bodyLarge); Spacer(Modifier.weight(1f)) }
            }
            IconButton(onClick = onDismiss, Modifier.align(Alignment.TopEnd).padding(12.dp)) { Icon(Icons.Rounded.Close, "Close", tint = Color.White, modifier = Modifier.size(34.dp)) }
          }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PlayerBottomAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    showLabel: Boolean,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier.combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = if (showLabel) 10.dp else 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, label, tint = Color.White)
        if (showLabel) { Spacer(Modifier.width(6.dp)); Text(label, color = Color.White) }
    }
}

private data class PlayerTrackOption(val group: Tracks.Group, val index: Int) {
    private val format get() = group.getTrackFormat(index)
    val supported get() = group.isTrackSupported(index)
    val selected get() = group.isTrackSelected(index)
    val key get() = "${group.mediaTrackGroup.id}:$index"
    private val labelLanguage get() = format.label?.substringBefore('(')?.substringBefore('[')?.trim()?.lowercase()
    val languageKey get() = format.language?.takeIf { it.isNotBlank() }?.substringBefore('-') ?: when (labelLanguage) { "english" -> "en"; "spanish", "español" -> "es"; "german", "deutsch" -> "de"; "arabic", "العربية" -> "ar"; "japanese", "日本語" -> "ja"; "indonesian", "bahasa indonesia" -> "id"; "french", "français" -> "fr"; "italian", "italiano" -> "it"; "portuguese", "português" -> "pt"; else -> labelLanguage ?: "und" }
    val languageName get() = languageKey.takeUnless { it == "und" }?.let { java.util.Locale.forLanguageTag(it).displayLanguage.replaceFirstChar(Char::uppercase) } ?: format.label ?: "Unknown language"
    val variantName get(): String {
        val label = format.label?.trim().orEmpty()
        if ('·' in label) return label.substringAfter('·').trim().ifBlank { "Add-on subtitle" }
        val normalizedLabel = label.substringBefore('(').trim().lowercase()
        val languageOnly = normalizedLabel in setOf("english", "spanish", "español", "german", "deutsch", "arabic", "japanese", "turkish", "zh", "chinese", "indonesian", "french", "italian", "portuguese")
        return if (label.isBlank() || languageOnly) "Embedded" else "$label · Embedded"
    }
}

@Composable
private fun PlayerTrackRow(label: String, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled, color = if (selected) MaterialTheme.colorScheme.primary.copy(.18f) else Color.White.copy(.06f), shape = RoundedCornerShape(14.dp), border = if (selected) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Text(label, color = Color.White.copy(if (enabled) 1f else .38f), modifier = Modifier.weight(1f)); if (selected) Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) else if (!enabled) Icon(Icons.Rounded.Block, null, tint = Color.White.copy(.35f)) }
    }
}

@Composable
private fun PlayerAudioTrackRow(
    display: AudioTrackDisplay,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Surface(onClick = onClick, enabled = enabled, color = if (selected) MaterialTheme.colorScheme.primary.copy(.18f) else Color.White.copy(.06f), shape = RoundedCornerShape(14.dp), border = if (selected) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(display.primary, color = Color.White.copy(if (enabled) 1f else .38f), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(display.secondary, color = Color.White.copy(if (enabled) .6f else .3f), style = MaterialTheme.typography.bodySmall, maxLines = 1)
            }
            if (selected) Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) else if (!enabled) Icon(Icons.Rounded.Block, null, tint = Color.White.copy(.35f))
        }
    }
}

private fun formatPlayerTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1_000
    val hours = seconds / 3_600
    val minutes = seconds % 3_600 / 60
    val remainder = seconds % 60
    return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}" else "$minutes:${remainder.toString().padStart(2, '0')}"
}
