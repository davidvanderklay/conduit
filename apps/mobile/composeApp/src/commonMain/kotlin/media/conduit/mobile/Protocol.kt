package media.conduit.mobile

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import media.conduit.mobile.account.PlaybackSource
import media.conduit.mobile.account.StreamItem
import media.conduit.mobile.account.StreamSource

const val ProtocolVersion = 2
const val TestStreamUrl =
    "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4"

/** Per-device playback limits so TV clients shape selection without a protocol break. */
@Serializable
data class DeviceConstraints(val maxResolutionHeight: Int? = null)

const val FixtureManifest = """
{"id":"media.conduit.fixture","version":"1.0.0","name":"Conduit Fixture",
"resources":[{"name":"stream","types":["movie"],"idPrefixes":["conduit:"]}],
"types":["movie"]}
"""
const val FixtureStreams = """
{"streams":[{"url":"$TestStreamUrl","title":"Big Buck Bunny"}]}
"""

@Serializable
sealed interface EngineAction {
    val protocolVersion: Int

    @Serializable
    @SerialName("resolveStreams")
    data class ResolveStreams(
        override val protocolVersion: Int = ProtocolVersion,
        val requestId: String,
        val manifestUrl: String = "https://fixture.conduit.invalid/manifest.json",
        val manifestJson: String = FixtureManifest,
        val streamsJson: String = FixtureStreams,
        val mediaType: String = "movie",
        val id: String = "conduit:for-bigger-blazes",
    ) : EngineAction

    @Serializable
    @SerialName("cancel")
    data class Cancel(
        override val protocolVersion: Int = ProtocolVersion,
        val requestId: String,
    ) : EngineAction

    @Serializable
    @SerialName("close")
    data class Close(override val protocolVersion: Int = ProtocolVersion) : EngineAction

    @Serializable
    @SerialName("playbackSource")
    data class PlaybackSource(
        override val protocolVersion: Int = ProtocolVersion,
        val requestId: String,
        val addonId: String,
        val stream: StreamItem,
    ) : EngineAction

    @Serializable
    @SerialName("selectSavedStream")
    data class SelectSavedStream(
        override val protocolVersion: Int = ProtocolVersion,
        val requestId: String,
        val sources: List<StreamSource>,
        val saved: media.conduit.mobile.account.PlaybackSource? = null,
    ) : EngineAction

    @Serializable
    @SerialName("selectSingleAutoStream")
    data class SelectSingleAutoStream(
        override val protocolVersion: Int = ProtocolVersion,
        val requestId: String,
        val sources: List<StreamSource>,
        val excluded: StreamItem? = null,
    ) : EngineAction

    @Serializable
    @SerialName("rankAutoStreams")
    data class RankAutoStreams(
        override val protocolVersion: Int = ProtocolVersion,
        val requestId: String,
        val sources: List<StreamSource>,
        val previous: media.conduit.mobile.account.PlaybackSource? = null,
        val saved: media.conduit.mobile.account.PlaybackSource? = null,
        val device: DeviceConstraints? = null,
    ) : EngineAction
}

@Serializable
sealed interface EngineState {
    val protocolVersion: Int

    @Serializable
    @SerialName("resolved")
    data class Resolved(
        override val protocolVersion: Int,
        val requestId: String,
        val generation: Long,
        val addonName: String,
        val requestUrl: String,
        val streamUrl: String,
        val streamTitle: String,
    ) : EngineState

    @Serializable
    @SerialName("cancelled")
    data class Cancelled(
        override val protocolVersion: Int,
        val requestId: String,
        val generation: Long,
    ) : EngineState

    @Serializable
    @SerialName("closed")
    data class Closed(override val protocolVersion: Int) : EngineState

    @Serializable
    @SerialName("sourceResolved")
    data class SourceResolved(
        override val protocolVersion: Int,
        val requestId: String,
        val playbackSource: PlaybackSource,
    ) : EngineState

    @Serializable
    @SerialName("savedStreamSelected")
    data class SavedStreamSelected(
        override val protocolVersion: Int,
        val requestId: String,
        val index: Int? = null,
    ) : EngineState

    @Serializable
    @SerialName("autoStreamSelected")
    data class AutoStreamSelected(
        override val protocolVersion: Int,
        val requestId: String,
        val index: Int? = null,
    ) : EngineState

    @Serializable
    @SerialName("autoStreamsRanked")
    data class AutoStreamsRanked(
        override val protocolVersion: Int,
        val requestId: String,
        val order: List<Int> = emptyList(),
    ) : EngineState

    @Serializable
    @SerialName("error")
    data class Error(
        override val protocolVersion: Int,
        val requestId: String? = null,
        val code: String,
        val message: String,
        val recoverable: Boolean,
    ) : EngineState
}

@Serializable
data class PlaybackState(
    val loading: Boolean = true,
    val buffering: Boolean = false,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
    val ended: Boolean = false,
    val error: String? = null,
    val pipReady: Boolean = false,
    val engine: NativePlaybackEngine = NativePlaybackEngine.Media3,
    val fallbackReason: String? = null,
)
