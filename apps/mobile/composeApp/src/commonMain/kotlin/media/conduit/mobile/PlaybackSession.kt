package media.conduit.mobile

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.PlaybackSource
import media.conduit.mobile.account.SubtitleItem
import media.conduit.mobile.account.StreamSource
import media.conduit.mobile.account.VideoItem

enum class PlaybackPresentation {
    FullScreen,
    Mini,
    SystemPip,
    Closed,
}

data class PlaybackIdentity(
    val profileId: String,
    val mediaType: String,
    val mediaId: String,
    val videoId: String,
)

/** Everything required to keep playing after the details screen leaves composition. */
data class PlaybackRequest(
    val identity: PlaybackIdentity,
    val url: String,
    val requestHeaders: Map<String, String> = emptyMap(),
    val subtitles: List<SubtitleItem> = emptyList(),
    val title: String,
    val mediaName: String,
    val artwork: String? = null,
    val logo: String? = null,
    val poster: String? = null,
    val episodeTitle: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val startPositionMs: Long = 0,
    val source: PlaybackSource? = null,
    val autoRecoveryAttempt: Boolean = false,
    val hasNextEpisode: Boolean = false,
    val nextEpisodeTitle: String? = null,
    val nextEpisodeArtwork: String? = null,
    val hasEpisodes: Boolean = false,
    val mediaItem: CatalogItem? = null,
    val episodes: List<VideoItem> = emptyList(),
)

sealed interface PlaybackCommand {
    data object Play : PlaybackCommand
    data object Pause : PlaybackCommand
    data class SeekTo(val positionMs: Long) : PlaybackCommand
    data object EnterSystemPip : PlaybackCommand
    data object RetryVideoOutput : PlaybackCommand
}

data class SequencedPlaybackCommand(
    val sequence: Long,
    val command: PlaybackCommand,
)

data class PlaybackSessionState(
    val request: PlaybackRequest? = null,
    val sessionId: String = "",
    val presentation: PlaybackPresentation = PlaybackPresentation.Closed,
    val playback: PlaybackState = PlaybackState(),
    val selectedAudioTrackId: String? = null,
    val selectedSubtitleTrackId: String? = null,
    val resizeMode: Int = 0,
    val systemPipAvailable: Boolean = false,
    val command: SequencedPlaybackCommand? = null,
    val episodePickerOpen: Boolean = false,
    val streamPicker: PlaybackStreamPickerState? = null,
)

class PlaybackSessionCallbacks(
    val persist: suspend (PlaybackRequest, PlaybackState) -> Unit,
    val persistCheckpoint: suspend (PlaybackRequest, PlaybackState, PlaybackCheckpointIdentity) -> Unit =
        { request, playback, _ -> persist(request, playback) },
    val playNext: () -> Unit,
    val openEpisodes: () -> Unit,
    val minimized: () -> Unit,
    val closed: () -> Unit,
    val selectEpisode: (String) -> Unit = {},
    val closeStreamPicker: () -> Unit = {},
    val backToEpisodes: () -> Unit = {},
    val selectStreamAddon: (String?) -> Unit = {},
    val retryStreams: () -> Unit = {},
    val selectStream: (StreamSource) -> Unit = {},
    val autoRecoveryFailed: (String) -> Unit = {},
)

data class PlaybackCheckpointIdentity(
    val sessionId: String,
    val sequence: Long,
)

@Stable
class PlaybackSessionController(
    private val scope: CoroutineScope,
) {
    private data class PendingPersistence(
        val request: PlaybackRequest,
        val playback: PlaybackState,
        val identity: PlaybackCheckpointIdentity,
        val callback: suspend (PlaybackRequest, PlaybackState, PlaybackCheckpointIdentity) -> Unit,
    )

    var state by mutableStateOf(PlaybackSessionState())
        private set

    private var callbacks: PlaybackSessionCallbacks? = null
    private var commandSequence = 0L
    private var sessionSequence = 0L
    private var checkpointSequence = 0L
    private val pendingPersistence = linkedMapOf<String, PendingPersistence>()
    private var persistenceJob: Job? = null

    fun start(request: PlaybackRequest, callbacks: PlaybackSessionCallbacks) {
        val current = state.request
        val sameStream = current?.isSameStream(request) == true
        if (current != null && !sameStream) persist()
        this.callbacks = callbacks
        state = if (sameStream) {
            // Reopening a minimized stream should resume the live player. Keeping
            // the existing playback state avoids rebuilding the stream and
            // leaving the details screen behind a second loading surface.
            state.copy(
                request = request,
                presentation = PlaybackPresentation.FullScreen,
            )
        } else {
            // A new stream gets a clean playback state and immediately replaces
            // the old miniplayer.
            PlaybackSessionState(
                request = request,
                sessionId = "playback-${++sessionSequence}",
                presentation = PlaybackPresentation.FullScreen,
            )
        }
        if (!sameStream) checkpointSequence = 0L
    }

    fun attach(identity: PlaybackIdentity, callbacks: PlaybackSessionCallbacks) {
        if (state.request?.identity == identity) this.callbacks = callbacks
    }

    fun updatePlayback(playback: PlaybackState) {
        if (state.request != null) state = state.copy(playback = playback)
    }

    fun updatePlayback(sessionId: String, streamKey: String, playback: PlaybackState) {
        val request = state.request ?: return
        if (state.sessionId == sessionId && request.streamKeyForPlayback() == streamKey) {
            state = state.copy(playback = playback)
        }
    }

    fun minimize(notifyOwner: Boolean = true) {
        if (state.request == null) return
        val hadStreamPicker = state.streamPicker != null
        persist()
        state = state.copy(
            presentation = PlaybackPresentation.Mini,
            episodePickerOpen = false,
            streamPicker = null,
        )
        if (hadStreamPicker) callbacks?.closeStreamPicker?.invoke()
        if (notifyOwner) callbacks?.minimized?.invoke()
    }

    fun restore() {
        if (state.request == null) return
        state = state.copy(presentation = PlaybackPresentation.FullScreen)
    }

    fun leaveFullScreen(miniplayerOnBack: Boolean) {
        if (miniplayerOnBack) minimize() else close()
    }

    fun systemPipChanged(active: Boolean) {
        if (state.request == null) return
        val wasInPip = state.presentation == PlaybackPresentation.SystemPip
        when {
            active && !wasInPip -> {
                persist()
                state = state.copy(presentation = PlaybackPresentation.SystemPip)
            }
            !active && wasInPip -> {
                state = state.copy(presentation = PlaybackPresentation.FullScreen)
                persist()
            }
        }
    }

    fun systemPipAvailabilityChanged(available: Boolean) {
        if (state.request != null && state.systemPipAvailable != available) {
            state = state.copy(systemPipAvailable = available)
        }
    }

    fun close(saveProgress: Boolean = true) {
        if (state.request == null) return
        if (saveProgress) persist()
        val closed = callbacks?.closed
        state = PlaybackSessionState()
        callbacks = null
        closed?.invoke()
    }

    fun persist() {
        val request = state.request ?: return
        val playback = state.playback
        val callbacks = callbacks ?: return
        val identity = PlaybackCheckpointIdentity(state.sessionId, ++checkpointSequence)
        pendingPersistence[request.persistenceKey()] = PendingPersistence(request, playback, identity, callbacks.persistCheckpoint)
        if (persistenceJob?.isActive != true) {
            persistenceJob = scope.launch { drainPersistence() }
        }
    }

    suspend fun flush() {
        persist()
        persistenceJob?.join()
    }

    private suspend fun drainPersistence() {
        while (true) {
            val next = pendingPersistence.entries.firstOrNull()?.let { (key, value) ->
                pendingPersistence.remove(key)
                value
            } ?: break
            runCatching { next.callback(next.request, next.playback, next.identity) }
        }
        persistenceJob = null
        if (pendingPersistence.isNotEmpty() && persistenceJob?.isActive != true) {
            persistenceJob = scope.launch { drainPersistence() }
        }
    }

    fun playNext() {
        if (state.request == null) return
        persist()
        callbacks?.playNext?.invoke()
    }

    fun openEpisodes() {
        if (state.request == null) return
        state = state.copy(episodePickerOpen = true)
        callbacks?.openEpisodes?.invoke()
    }

    fun closeEpisodes() {
        if (state.episodePickerOpen) state = state.copy(episodePickerOpen = false)
    }

    fun showStreamPicker(picker: PlaybackStreamPickerState) {
        if (state.request == null) return
        state = state.copy(
            episodePickerOpen = false,
            streamPicker = picker,
        )
    }

    fun updateStreamPicker(picker: PlaybackStreamPickerState) {
        if (state.request == null || state.streamPicker == null) return
        state = state.copy(streamPicker = picker)
    }

    fun closeStreamPicker() {
        if (state.streamPicker == null) return
        state = state.copy(streamPicker = null)
        callbacks?.closeStreamPicker?.invoke()
    }

    fun backToEpisodes() {
        if (state.streamPicker == null) return
        state = state.copy(
            streamPicker = null,
            episodePickerOpen = true,
        )
        callbacks?.backToEpisodes?.invoke()
    }

    fun selectStreamAddon(addonId: String?) {
        if (state.streamPicker == null) return
        callbacks?.selectStreamAddon?.invoke(addonId)
    }

    fun retryStreams() {
        if (state.streamPicker == null) return
        callbacks?.retryStreams?.invoke()
    }

    fun selectStream(source: StreamSource) {
        if (state.streamPicker == null) return
        state = state.copy(streamPicker = null)
        callbacks?.selectStream?.invoke(source)
    }

    fun autoRecoveryFailed(sessionId: String, message: String) {
        if (state.sessionId == sessionId && state.request?.autoRecoveryAttempt == true) {
            callbacks?.autoRecoveryFailed?.invoke(message)
        }
    }

    fun selectEpisode(videoId: String) {
        if (state.request == null) return
        closeEpisodes()
        persist()
        callbacks?.selectEpisode?.invoke(videoId)
    }

    fun send(command: PlaybackCommand) {
        if (state.request == null) return
        commandSequence += 1
        state = state.copy(command = SequencedPlaybackCommand(commandSequence, command))
    }
}

private fun PlaybackRequest.isSameStream(other: PlaybackRequest): Boolean =
    identity == other.identity &&
        url == other.url &&
        requestHeaders == other.requestHeaders &&
        subtitles == other.subtitles

internal fun PlaybackRequest.streamKeyForPlayback(): String =
    buildString {
        append(identity.profileId)
        append(':')
        append(identity.mediaType)
        append(':')
        append(identity.mediaId)
        append(':')
        append(identity.videoId)
        append('|')
        append(url)
        append('|')
        append(requestHeaders)
        append('|')
        append(subtitles)
    }

internal fun savedStreamStartupStalled(
    request: PlaybackRequest,
    playback: PlaybackState,
): Boolean = request.autoRecoveryAttempt &&
    playback.positionMs <= request.startPositionMs &&
    !playback.playing &&
    !playback.ended &&
    (playback.videoWidth <= 0 || playback.videoHeight <= 0)

private fun PlaybackRequest.persistenceKey(): String =
    "${identity.profileId}\u0000${identity.videoId}"

fun transitionPlaybackPresentation(
    current: PlaybackPresentation,
    command: PlaybackPresentationCommand,
): PlaybackPresentation = when (command) {
    PlaybackPresentationCommand.Minimize -> if (current == PlaybackPresentation.Closed) current else PlaybackPresentation.Mini
    PlaybackPresentationCommand.Restore -> if (current == PlaybackPresentation.Closed) current else PlaybackPresentation.FullScreen
    PlaybackPresentationCommand.EnterSystemPip -> if (current == PlaybackPresentation.Closed) current else PlaybackPresentation.SystemPip
    PlaybackPresentationCommand.ExitSystemPip -> if (current == PlaybackPresentation.SystemPip) PlaybackPresentation.FullScreen else current
    PlaybackPresentationCommand.Close -> PlaybackPresentation.Closed
}

enum class PlaybackPresentationCommand {
    Minimize,
    Restore,
    EnterSystemPip,
    ExitSystemPip,
    Close,
}

fun clampPipAspectRatio(width: Int, height: Int): Pair<Int, Int> {
    val safeWidth = width.coerceAtLeast(1)
    val safeHeight = height.coerceAtLeast(1)
    val ratio = safeWidth.toDouble() / safeHeight
    return when {
        ratio > 2.39 -> 239 to 100
        ratio < 1.0 / 2.39 -> 100 to 239
        else -> safeWidth to safeHeight
    }
}

fun playbackAspectRatio(width: Int, height: Int): Float {
    if (width <= 0 || height <= 0) return 16f / 9f
    val (safeWidth, safeHeight) = clampPipAspectRatio(width, height)
    return safeWidth.toFloat() / safeHeight.toFloat()
}
