package media.conduit.mobile

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

const val ProtocolVersion = 2
const val TestStreamUrl =
    "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4"

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
)
