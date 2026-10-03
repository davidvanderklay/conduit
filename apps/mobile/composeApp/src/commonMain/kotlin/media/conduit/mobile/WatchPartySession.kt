package media.conduit.mobile

import androidx.compose.runtime.*
import io.ktor.client.plugins.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import media.conduit.mobile.account.*
import kotlin.math.abs
import kotlin.time.Clock
import kotlin.time.TimeSource

internal val LocalWatchParty = staticCompositionLocalOf<WatchPartySessionController?> { null }

@Serializable
internal data class PartyTimeline(
    val position: Double,
    val duration: Double,
    val playing: Boolean,
    val rate: Double,
    val sequence: Long,
    val serverTime: Long,
    val epoch: String,
    val generation: Long,
)

/** Profile-scoped session. The sheet and native player observe it without owning its socket. */
internal class WatchPartySessionController(
    private val scope: CoroutineScope,
    private val api: ConduitApi,
    val baseUrl: String,
    private val token: String,
    val profileId: String,
    private val playback: PlaybackSessionController,
) {
    var party by mutableStateOf<WatchPartySummary?>(null)
        private set
    var media by mutableStateOf<WatchPartyMedia?>(null)
        private set
    var connection by mutableStateOf("Disconnected")
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var sheetOpen by mutableStateOf(false)
    var inviteLink by mutableStateOf("")
    val isGuest get() = party != null && party?.isHost != true
    private val client = createPlatformHttpClient()
    private val json = Json { ignoreUnknownKeys = true }
    private var socket: DefaultClientWebSocketSession? = null
    private var job: Job? = null
    private var sequence = 0L
    private var epoch = ""
    private var generation = 0L
    private var revision = -1L
    private var clockOffset = 0L
    private var bestRoundTrip = Long.MAX_VALUE
    private var timeline: PartyTimeline? = null
    private var timelineReceived = TimeSource.Monotonic.markNow()
    private var projectedAtReceive = 0.0
    private var lastReady: Boolean? = null
    private var publishedMedia: WatchPartyMedia? = null

    fun join(response: WatchPartySessionResponse) {
        disconnect()
        party = response.party
        media = response.party.media
        publishedMedia = response.party.media
        playback.partyGuest = !response.party.isHost
        error = null
        job = scope.launch {
            var ticket = WatchPartyTicket(response.ticket, response.expiresAt, response.socketPath)
            var attempt = 0
            while (isActive && party?.id == response.party.id) {
                try {
                    connection = "Connecting"
                    val url = baseUrl.trimEnd('/').replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + ticket.socketPath + "?ticket=" + ticket.ticket
                    client.webSocket(urlString = url) {
                        socket = this
                        connection = "Connected"
                        attempt = 0
                        bestRoundTrip = Long.MAX_VALUE
                        lastReady = null
                        send(Frame.Text(buildJsonObject { put("v", 1); put("type", "clock"); put("clientTime", now()) }.toString()))
                        val observer = launch {
                            while (isActive) {
                                publishReady()
                                publishPlayback()
                                applyPlayback()
                                delay(1000)
                            }
                        }
                        try {
                            for (frame in incoming) if (frame is Frame.Text) receive(frame.readText())
                        } finally { observer.cancel() }
                        val reason = closeReason.await()
                        if (reason?.code == 1000.toShort() || reason?.code == 1008.toShort()) {
                            party = null
                            media = null
                            playback.partyGuest = false
                        }
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = "Party connection interrupted" }
                finally { socket = null; connection = "Reconnecting" }
                if (party == null) break
                if (isGuest) playback.sendPartyState(null, 1f, false)
                delay((500L shl attempt.coerceAtMost(4)).coerceAtMost(10_000))
                attempt++
                try { ticket = api.refreshWatchPartyTicket(baseUrl, token, response.party.id, profileId) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: ServerRequestException) {
                    if (failure.statusCode == 403 || failure.statusCode == 404) { disconnect(); break }
                }
                catch (failure: Exception) { error = "Unable to reconnect. Retrying." }
            }
        }
    }

    suspend fun leave() {
        val active = party ?: return
        if (active.isHost) api.endWatchParty(baseUrl, token, active.id, profileId)
        else api.leaveWatchParty(baseUrl, token, active.id, profileId)
        disconnect()
    }
    fun disconnect() {
        job?.cancel()
        job = null
        socket = null
        party = null
        media = null
        timeline = null
        epoch = ""
        revision = -1
        playback.partyGuest = false
        connection = "Disconnected"
    }
    fun close() { disconnect(); client.close() }

    private suspend fun publishReady() {
        val request = playback.state.request
        val current = playback.state.playback
        val ready = request?.identity?.videoId == media?.videoId && !current.loading && !current.buffering && current.durationMs > 0
        if (ready != lastReady) {
            send(buildJsonObject { put("type", "ready"); put("ready", ready) })
            lastReady = ready
        }
    }

    private suspend fun publishPlayback() {
        val active = party ?: return
        if (!active.isHost || epoch.isEmpty()) return
        val request = playback.state.request ?: return
        val current = playback.state.playback
        val selected = WatchPartyMedia(request.identity.mediaType, request.identity.mediaId, request.identity.videoId, request.mediaName, request.poster, request.title, request.season, request.episode)
        if (selected != publishedMedia) {
            api.updateWatchPartyMedia(baseUrl, token, active.id, profileId, selected)
            publishedMedia = selected
            return
        }
        if (current.durationMs <= 0) return
        send(buildJsonObject {
            put("type", "state"); put("position", current.positionMs / 1000.0); put("duration", current.durationMs / 1000.0)
            put("playing", current.playing && !current.buffering && !current.loading); put("rate", current.rate); put("sequence", ++sequence)
            put("epoch", epoch); put("generation", generation)
        })
    }

    private fun applyPlayback() {
        if (!isGuest) return
        val currentMedia = media ?: return
        val request = playback.state.request ?: return
        if (request.identity.mediaId != currentMedia.mediaId || request.identity.videoId != currentMedia.videoId) return
        val current = playback.state.playback
        if (current.loading || current.buffering || current.durationMs <= 0) return
        val state = timeline ?: return
        val target = partyPosition(state, projectedAtReceive, timelineReceived.elapsedNow().inWholeMilliseconds)
        val seek = if (abs(current.positionMs / 1000.0 - target) > .75) (target * 1000).toLong() else null
        if (seek != null || state.playing != current.playing || abs(state.rate - current.rate) > .01) {
            playback.sendPartyState(seek, state.rate.toFloat(), state.playing)
        }
    }
    private fun receive(raw: String) {
        val message = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        if (message["v"]?.jsonPrimitive?.intOrNull != 1) return
        when (message["type"]?.jsonPrimitive?.contentOrNull) {
            "clock" -> {
                val sent = message["clientTime"]?.jsonPrimitive?.longOrNull ?: return
                val server = message["serverTime"]?.jsonPrimitive?.longOrNull ?: return
                val received = now()
                val roundTrip = received - sent
                if (roundTrip in 0..bestRoundTrip) { bestRoundTrip = roundTrip; clockOffset = server - (received + sent) / 2 }
            }
            "joined", "media" -> {
                val nextEpoch = message["epoch"]?.jsonPrimitive?.contentOrNull ?: return
                val nextGeneration = message["generation"]?.jsonPrimitive?.longOrNull ?: return
                if (epoch != nextEpoch || generation != nextGeneration) { timeline = null; revision = -1 }
                epoch = nextEpoch
                generation = nextGeneration
                media = message["media"]?.takeUnless { it is JsonNull }?.let { runCatching { json.decodeFromJsonElement<WatchPartyMedia>(it) }.getOrNull() }
                party = party?.copy(media = media)
                message["state"]?.takeUnless { it is JsonNull }?.let(::receiveTimeline)
                if (media == null && isGuest) playback.sendPartyState(null, 1f, false)
            }
            "state" -> receiveTimeline(message)
            "presence" -> {
                val members = message["participants"]?.let { runCatching { json.decodeFromJsonElement<List<WatchPartyMember>>(it) }.getOrNull() }.orEmpty().distinctBy { it.profileId }
                party = party?.copy(members = members, memberCount = members.size)
            }
            "host-disconnected" -> { connection = "Waiting for host"; if (isGuest) playback.sendPartyState(null, 1f, false) }
            "ended" -> { error = message["reason"]?.jsonPrimitive?.contentOrNull; disconnect() }
        }
    }
    private fun receiveTimeline(value: JsonElement) {
        val state = runCatching { json.decodeFromJsonElement<PartyTimeline>(value) }.getOrNull() ?: return
        if (!validPartyTimeline(state) || state.epoch != epoch || state.generation != generation || state.sequence <= revision) return
        revision = state.sequence
        timeline = state
        timelineReceived = TimeSource.Monotonic.markNow()
        projectedAtReceive = state.position + if (state.playing) ((now() + clockOffset - state.serverTime).coerceAtLeast(0) / 1000.0 * state.rate) else 0.0
        applyPlayback()
    }
    private suspend fun send(message: JsonObject) {
        socket?.send(Frame.Text(JsonObject(message + ("v" to JsonPrimitive(1))).toString()))
    }
    private fun now() = Clock.System.now().toEpochMilliseconds()
}
internal fun validPartyTimeline(state: PartyTimeline): Boolean =
    state.position.isFinite() && state.position >= 0 && state.duration.isFinite() && state.duration >= 0 && state.rate.isFinite() && state.rate in .1..4.0 && state.sequence >= 0 && state.generation >= 0
internal fun partyPosition(state: PartyTimeline, projected: Double, elapsedMs: Long): Double =
    (projected + if (state.playing) elapsedMs.coerceAtLeast(0) / 1000.0 * state.rate else 0.0).coerceAtMost(state.duration.takeIf { it > 0 } ?: Double.POSITIVE_INFINITY)
