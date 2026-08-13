package media.conduit.mobile

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import media.conduit.mobile.account.PlaybackSource
import media.conduit.mobile.account.SubtitleItem

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
    val hasNextEpisode: Boolean = false,
    val nextEpisodeTitle: String? = null,
    val nextEpisodeArtwork: String? = null,
    val hasEpisodes: Boolean = false,
)

sealed interface PlaybackCommand {
    data object Play : PlaybackCommand
    data object Pause : PlaybackCommand
    data class SeekTo(val positionMs: Long) : PlaybackCommand
    data object EnterSystemPip : PlaybackCommand
}

data class SequencedPlaybackCommand(
    val sequence: Long,
    val command: PlaybackCommand,
)

data class PlaybackSessionState(
    val request: PlaybackRequest? = null,
    val presentation: PlaybackPresentation = PlaybackPresentation.Closed,
    val playback: PlaybackState = PlaybackState(),
    val selectedAudioTrackId: String? = null,
    val selectedSubtitleTrackId: String? = null,
    val resizeMode: Int = 0,
    val systemPipAvailable: Boolean = false,
    val command: SequencedPlaybackCommand? = null,
)

class PlaybackSessionCallbacks(
    val persist: suspend (PlaybackRequest, PlaybackState) -> Unit,
    val playNext: () -> Unit,
    val openEpisodes: () -> Unit,
    val minimized: () -> Unit,
    val closed: () -> Unit,
)

@Stable
class PlaybackSessionController(
    private val scope: CoroutineScope,
) {
    private data class PendingPersistence(
        val request: PlaybackRequest,
        val playback: PlaybackState,
        val callback: suspend (PlaybackRequest, PlaybackState) -> Unit,
    )

    var state by mutableStateOf(PlaybackSessionState())
        private set

    private var callbacks: PlaybackSessionCallbacks? = null
    private var commandSequence = 0L
    private var pendingPersistence: PendingPersistence? = null
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
                presentation = PlaybackPresentation.FullScreen,
            )
        }
    }

    fun attach(identity: PlaybackIdentity, callbacks: PlaybackSessionCallbacks) {
        if (state.request?.identity == identity) this.callbacks = callbacks
    }

    fun updatePlayback(playback: PlaybackState) {
        if (state.request != null) state = state.copy(playback = playback)
    }

    fun minimize(notifyOwner: Boolean = true) {
        if (state.request == null) return
        persist()
        state = state.copy(presentation = PlaybackPresentation.Mini)
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
        val callback = callbacks?.persist ?: return
        pendingPersistence = PendingPersistence(request, playback, callback)
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
            val next = pendingPersistence ?: break
            pendingPersistence = null
            runCatching { next.callback(next.request, next.playback) }
        }
        persistenceJob = null
        if (pendingPersistence != null) persist()
    }

    fun playNext() {
        if (state.request == null) return
        persist()
        callbacks?.playNext?.invoke()
    }

    fun openEpisodes() {
        callbacks?.openEpisodes?.invoke()
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
    val (safeWidth, safeHeight) = clampPipAspectRatio(width, height)
    return safeWidth.toFloat() / safeHeight.toFloat()
}
