package media.conduit.mobile.account

import media.conduit.mobile.EngineAction
import media.conduit.mobile.EngineClient
import media.conduit.mobile.EngineState
import kotlin.random.Random

/**
 * Domain facade over the Rust selection engine (ADR 0005). All decisions are
 * computed by the native core; this class only maps Kotlin types to the wire
 * format and back.
 */
class StreamSelection(private val client: EngineClient) : AutoCloseable {

    override fun close() = client.close()

    fun playbackSourceFor(addonId: String, stream: StreamItem): PlaybackSource =
        when (
            val state = client.dispatch(
                EngineAction.PlaybackSource(
                    requestId = requestId(),
                    addonId = addonId,
                    stream = stream,
                ),
            )
        ) {
            is EngineState.SourceResolved -> state.playbackSource
            else -> fail(state)
        }

    fun selectSavedStream(streams: List<StreamSource>, saved: PlaybackSource?): StreamSource? {
        if (saved == null) return null
        return when (
            val state = client.dispatch(
                EngineAction.SelectSavedStream(
                    requestId = requestId(),
                    sources = candidates(streams),
                    saved = saved,
                ),
            )
        ) {
            is EngineState.SavedStreamSelected -> state.index?.let(streams::get)
            else -> fail(state)
        }
    }

    fun selectSingleAutoStream(
        streams: List<StreamSource>,
        excludedStream: StreamSource? = null,
    ): StreamSource? = when (
        val state = client.dispatch(
            EngineAction.SelectSingleAutoStream(
                requestId = requestId(),
                sources = candidates(streams),
                excluded = excludedStream?.stream,
            ),
        )
    ) {
        is EngineState.AutoStreamSelected -> state.index?.let(streams::get)
        else -> fail(state)
    }

    /** Ranks direct streams for an automatic transition without changing provider order on ties. */
    fun rankAutomaticStreams(
        streams: List<StreamSource>,
        previousSource: PlaybackSource? = null,
        savedSource: PlaybackSource? = null,
        device: media.conduit.mobile.DeviceConstraints? = null,
    ): List<StreamSource> = when (
        val state = client.dispatch(
            EngineAction.RankAutoStreams(
                requestId = requestId(),
                sources = candidates(streams),
                previous = previousSource,
                saved = savedSource,
                device = device,
            ),
        )
    ) {
        is EngineState.AutoStreamsRanked -> state.order.map(streams::get)
        else -> fail(state)
    }

    private fun candidates(streams: List<StreamSource>) = streams

    private fun fail(state: EngineState): Nothing =
        throw IllegalStateException("stream selection failed: $state")
}

private fun requestId() = "selection-${Random.nextLong(UInt.MAX_VALUE.toLong())}"
