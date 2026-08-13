package media.conduit.mobile

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
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
    var state by mutableStateOf(PlaybackSessionState())
        private set

    private var callbacks: PlaybackSessionCallbacks? = null
    private var commandSequence = 0L

    fun start(request: PlaybackRequest, callbacks: PlaybackSessionCallbacks) {
        val replacingRequest = state.request?.let { it.identity != request.identity || it.url != request.url } == true
        if (replacingRequest) persist()
        this.callbacks = callbacks
        val current = state.request
        state = if (current?.identity == request.identity && current.url == request.url) {
            state.copy(request = request)
        } else {
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

    fun systemPipChanged(active: Boolean) {
        if (state.request == null) return
        val wasInPip = state.presentation == PlaybackPresentation.SystemPip
        when {
            active && !wasInPip -> state = state.copy(presentation = PlaybackPresentation.SystemPip)
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
        scope.launch { runCatching { callback(request, playback) } }
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
