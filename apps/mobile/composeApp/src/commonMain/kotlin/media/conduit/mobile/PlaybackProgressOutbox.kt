package media.conduit.mobile

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.time.Clock
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.account.PlaybackSource
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.foundation.SecureStore

private const val ProgressOutboxKey = "playback.progress.outbox.v1"
private const val ContinueWatchingEntryPositionMs = 30_000L

internal data class ProgressWriteOutcome(
    val progress: ProgressSummary,
    val synced: Boolean,
)

internal data class FlushedProgress(
    val identity: PlaybackCheckpointIdentity,
    val progress: ProgressSummary,
)

@Serializable
private data class PersistedProgressCheckpoint(
    val profileId: String,
    val videoId: String,
    val mediaType: String,
    val mediaId: String,
    val name: String,
    val poster: String? = null,
    val videoTitle: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val positionMs: Long,
    val durationMs: Long,
    val watched: Boolean? = null,
    val playbackSource: PlaybackSource? = null,
    val sessionId: String,
    val sequence: Long,
    val updatedAt: String,
)

/**
 * Stores the newest valid playback checkpoint locally before attempting the
 * network. One queued row exists per profile and video, so a stalled device
 * cannot lose the position that the user last reached.
 */
internal class PlaybackProgressOutbox(
    private val api: ConduitApi,
    private val secureStore: SecureStore,
) {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }
    private val stateMutex = Mutex()
    private val drainMutex = Mutex()
    private val pending = linkedMapOf<String, PersistedProgressCheckpoint>()
    private var loaded = false

    suspend fun enqueue(
        baseUrl: String,
        token: String,
        request: PlaybackRequest,
        playback: PlaybackState,
        identity: PlaybackCheckpointIdentity,
        existing: ProgressSummary?,
        watchedOverride: Boolean? = null,
    ): ProgressWriteOutcome {
        val checkpoint = checkpoint(request, playback, identity, watchedOverride)
        val local = checkpoint.toSummary(existing)
        stateMutex.withLock {
            loadLocked()
            pending[checkpoint.key()] = checkpoint
            persistLocked()
        }

        val flushed = flush(baseUrl, token)
        val synced = flushed.firstOrNull { it.identity == identity && it.progress.videoId == request.identity.videoId }
        return ProgressWriteOutcome(synced?.progress ?: local, synced != null)
    }

    suspend fun flush(baseUrl: String, token: String): List<FlushedProgress> =
        drainMutex.withLock {
            val flushed = mutableListOf<FlushedProgress>()
            while (true) {
                val next = stateMutex.withLock {
                    loadLocked()
                    pending.values.firstOrNull()
                } ?: break

                val saved = try {
                    api.saveProgress(
                        baseUrl = baseUrl,
                        token = token,
                        profileId = next.profileId,
                        videoId = next.videoId,
                        mediaType = next.mediaType,
                        mediaId = next.mediaId,
                        name = next.name,
                        poster = next.poster,
                        videoTitle = next.videoTitle,
                        season = next.season,
                        episode = next.episode,
                        positionMs = next.positionMs,
                        durationMs = next.durationMs,
                        playbackSource = next.playbackSource,
                        watched = next.watched,
                        checkpointSessionId = next.sessionId,
                        checkpointSequence = next.sequence,
                        checkpointUpdatedAt = next.updatedAt,
                    ) ?: throw IllegalStateException("The server returned no playback progress")
                } catch (cause: Throwable) {
                    if (cause is CancellationException) throw cause
                    // Leave the checkpoint in place. The next foreground or
                    // playback checkpoint will retry it without user action.
                    break
                }

                stateMutex.withLock {
                    loadLocked()
                    val current = pending[next.key()]
                    if (current?.identity() == next.identity()) {
                        pending.remove(next.key())
                        persistLocked()
                    }
                }
                flushed += FlushedProgress(next.identity(), saved)
            }
            flushed
        }

    suspend fun pendingSummaries(profileId: String): List<ProgressSummary> = stateMutex.withLock {
        loadLocked()
        pending.values
            .filter { it.profileId == profileId }
            .map { it.toSummary(existing = null) }
    }

    suspend fun clear() = stateMutex.withLock {
        pending.clear()
        loaded = true
        secureStore.remove(ProgressOutboxKey)
    }

    private fun checkpoint(
        request: PlaybackRequest,
        playback: PlaybackState,
        identity: PlaybackCheckpointIdentity,
        watchedOverride: Boolean?,
    ): PersistedProgressCheckpoint = PersistedProgressCheckpoint(
        profileId = request.identity.profileId,
        videoId = request.identity.videoId,
        mediaType = request.identity.mediaType,
        mediaId = request.identity.mediaId,
        name = request.mediaName,
        poster = request.poster,
        videoTitle = request.episodeTitle,
        season = request.season,
        episode = request.episode,
        positionMs = playback.positionMs.coerceAtLeast(0),
        durationMs = playback.durationMs.coerceAtLeast(0),
        watched = watchedOverride,
        sessionId = identity.sessionId,
        sequence = identity.sequence,
        updatedAt = Clock.System.now().toString(),
        playbackSource = request.source,
    )

    private fun PersistedProgressCheckpoint.toSummary(existing: ProgressSummary?): ProgressSummary {
        val completed = watched ?: isPlaybackComplete(positionMs, durationMs)
        return ProgressSummary(
            videoId = videoId,
            mediaType = mediaType,
            mediaId = mediaId,
            name = name,
            poster = poster,
            videoTitle = videoTitle,
            season = season,
            episode = episode,
            positionMs = if (completed) durationMs.takeIf { it > 0 } ?: positionMs else positionMs,
            durationMs = durationMs,
            watched = completed,
            dismissed = false,
            continueWatching = existing?.continueWatching == true ||
                completed ||
                positionMs >= ContinueWatchingEntryPositionMs,
            playbackSource = playbackSource,
            updatedAt = updatedAt,
        )
    }

    private fun loadLocked() {
        if (loaded) return
        loaded = true
        val restored = secureStore.get(ProgressOutboxKey)
            ?.let { runCatching { json.decodeFromString<List<PersistedProgressCheckpoint>>(it) }.getOrNull() }
            .orEmpty()
        restored.forEach { pending[it.key()] = it }
    }

    private fun persistLocked() {
        if (pending.isEmpty()) {
            secureStore.remove(ProgressOutboxKey)
        } else {
            secureStore.put(ProgressOutboxKey, json.encodeToString(pending.values.toList()))
        }
    }
}

private fun PersistedProgressCheckpoint.key(): String = "$profileId\u0000$videoId"

private fun PersistedProgressCheckpoint.identity(): PlaybackCheckpointIdentity =
    PlaybackCheckpointIdentity(sessionId, sequence)

private fun isPlaybackComplete(positionMs: Long, durationMs: Long): Boolean {
    if (positionMs < 0 || durationMs <= 0) return false
    return positionMs.toDouble() / durationMs >= 0.9 ||
        (durationMs >= 600_000 && durationMs - positionMs <= 120_000)
}
