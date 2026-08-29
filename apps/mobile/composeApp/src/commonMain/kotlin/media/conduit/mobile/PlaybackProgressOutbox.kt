package media.conduit.mobile

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.Json
import kotlin.time.Clock
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.account.PlaybackSource
import media.conduit.mobile.account.ProgressSummary
import media.conduit.mobile.account.IncrementalProgressRepository
import media.conduit.mobile.account.ProgressIdentity
import media.conduit.mobile.account.ProgressOperation
import media.conduit.mobile.foundation.SecureStore

private const val ProgressOutboxKeyPrefix = "playback.progress.outbox.v1"
private const val ProgressStoreThresholdPositionMs = 1_000L

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
    private val incremental: IncrementalProgressRepository? = null,
) {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }
    private val stateMutex = Mutex()
    private val drainMutex = Mutex()
    private val pending = linkedMapOf<String, PersistedProgressCheckpoint>()
    private var loadedKey: String? = null
    private var legacyKeyCleared = false

    suspend fun enqueue(
        baseUrl: String,
        token: String,
        accountId: String,
        request: PlaybackRequest,
        playback: PlaybackState,
        identity: PlaybackCheckpointIdentity,
        existing: ProgressSummary?,
        watchedOverride: Boolean? = null,
    ): ProgressWriteOutcome? {
        val checkpoint = checkpoint(request, playback, identity, watchedOverride)
        val local = checkpoint.toSummary(existing)
        if (!local.watched && checkpoint.positionMs < ProgressStoreThresholdPositionMs) return null
        incremental?.let { repository ->
            val operationId = repository.enqueue(
                baseUrl,
                accountId,
                request.identity.profileId,
                ProgressOperation.Upsert(
                    identity = ProgressIdentity(
                        mediaType = request.identity.mediaType,
                        mediaId = request.identity.mediaId,
                        canonicalTitleId = existing?.canonicalTitleId,
                        aliases = request.mediaAliases,
                        videoId = request.identity.videoId,
                        season = request.season,
                        episode = request.episode,
                    ),
                    name = request.mediaName,
                    poster = request.poster,
                    videoTitle = request.episodeTitle,
                    positionMs = local.positionMs,
                    durationMs = local.durationMs,
                    watched = local.watched,
                    playbackSource = local.playbackSource,
                    checkpointSessionId = identity.sessionId,
                    checkpointSequence = identity.sequence,
                ),
            )
            val projection = repository.synchronize(baseUrl, token, accountId, request.identity.profileId)
            val saved = projection.firstOrNull {
                it.videoId == request.identity.videoId ||
                    (it.mediaType == request.identity.mediaType && it.mediaId == request.identity.mediaId &&
                        it.season == request.season && it.episode == request.episode)
            } ?: local
            val synced = repository.diagnostics(baseUrl, accountId, request.identity.profileId)
                .none { it.operationId == operationId }
            return ProgressWriteOutcome(preserveNewerLocalProgress(local, saved), synced)
        }
        val storageKey = storageKey(baseUrl, accountId)
        stateMutex.withLock {
            loadLocked(storageKey)
            pending[checkpoint.key()] = checkpoint
            persistLocked(storageKey)
        }

        val flushed = flush(baseUrl, token, accountId)
        val synced = flushed.firstOrNull { it.identity == identity && it.progress.videoId == request.identity.videoId }
        return ProgressWriteOutcome(
            progress = synced?.let { preserveNewerLocalProgress(local, it.progress) } ?: local,
            synced = synced != null,
        )
    }

    suspend fun flush(baseUrl: String, token: String, accountId: String): List<FlushedProgress> =
        drainMutex.withLock {
            val storageKey = storageKey(baseUrl, accountId)
            incremental?.let { repository ->
                val legacy = stateMutex.withLock {
                    loadLocked(storageKey)
                    pending.values.toList()
                }
                legacy.forEach { checkpoint ->
                    repository.enqueue(
                        baseUrl,
                        accountId,
                        checkpoint.profileId,
                        ProgressOperation.Upsert(
                            identity = ProgressIdentity(
                                checkpoint.mediaType,
                                checkpoint.mediaId,
                                videoId = checkpoint.videoId,
                                season = checkpoint.season,
                                episode = checkpoint.episode,
                            ),
                            name = checkpoint.name,
                            poster = checkpoint.poster,
                            videoTitle = checkpoint.videoTitle,
                            positionMs = checkpoint.positionMs,
                            durationMs = checkpoint.durationMs,
                            watched = checkpoint.toSummary(null).watched,
                            playbackSource = checkpoint.playbackSource,
                            checkpointSessionId = checkpoint.sessionId,
                            checkpointSequence = checkpoint.sequence,
                        ),
                    )
                    stateMutex.withLock {
                        loadLocked(storageKey)
                        if (pending[checkpoint.key()]?.identity() == checkpoint.identity()) {
                            pending.remove(checkpoint.key())
                            persistLocked(storageKey)
                        }
                    }
                }
                return@withLock emptyList()
            }
            val flushed = mutableListOf<FlushedProgress>()
            val candidates = stateMutex.withLock {
                loadLocked(storageKey)
                pending.values.toList()
            }
            for (next in candidates) {

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
                    continue
                }

                if (!isProgressCheckpointAccepted(next.toSummary(existing = null), saved)) {
                    // A successful HTTP response can still be the existing row
                    // when the server coalesces a small update. Keep the newer
                    // checkpoint queued so a later checkpoint can retry it.
                    continue
                }

                stateMutex.withLock {
                    loadLocked(storageKey)
                    val current = pending[next.key()]
                    if (current?.identity() == next.identity()) {
                        pending.remove(next.key())
                        persistLocked(storageKey)
                    }
                }
                flushed += FlushedProgress(next.identity(), saved)
            }
            flushed
        }

    suspend fun pendingSummaries(baseUrl: String, accountId: String, profileId: String): List<ProgressSummary> = stateMutex.withLock {
        loadLocked(storageKey(baseUrl, accountId))
        pending.values
            .filter { it.profileId == profileId }
            .map { it.toSummary(existing = null) }
    }

    suspend fun clear(baseUrl: String, accountId: String) = stateMutex.withLock {
        val storageKey = storageKey(baseUrl, accountId)
        loadLocked(storageKey)
        pending.clear()
        persistLocked(storageKey)
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
        playbackSource = request.source?.takeIf {
            !playback.loading &&
                playback.error == null &&
                playback.videoWidth > 0 &&
                playback.videoHeight > 0
        },
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
                positionMs >= ProgressStoreThresholdPositionMs,
            playbackSource = playbackSource,
            updatedAt = updatedAt,
        )
    }

    private fun loadLocked(storageKey: String) {
        if (loadedKey == storageKey) return
        pending.clear()
        loadedKey = storageKey
        if (!legacyKeyCleared) {
            // The pre-scoped queue could belong to another account. Never
            // replay it after upgrading into the scoped storage format.
            secureStore.remove(ProgressOutboxKeyPrefix)
            legacyKeyCleared = true
        }
        val restored = secureStore.get(storageKey)
            ?.let { runCatching { json.decodeFromString<List<PersistedProgressCheckpoint>>(it) }.getOrNull() }
            .orEmpty()
        restored.forEach { pending[it.key()] = it }
    }

    private fun persistLocked(storageKey: String) {
        if (pending.isEmpty()) {
            secureStore.remove(storageKey)
        } else {
            secureStore.put(storageKey, json.encodeToString(pending.values.toList()))
        }
    }

    private fun storageKey(baseUrl: String, accountId: String): String =
        "$ProgressOutboxKeyPrefix.${scopePart(baseUrl)}.${scopePart(accountId)}"
}

private fun scopePart(value: String): String = value.hashCode().toUInt().toString(16)

private fun PersistedProgressCheckpoint.key(): String = "$profileId\u0000$videoId"

private fun PersistedProgressCheckpoint.identity(): PlaybackCheckpointIdentity =
    PlaybackCheckpointIdentity(sessionId, sequence)

private fun isPlaybackComplete(positionMs: Long, durationMs: Long): Boolean {
    return coreValue(buildJsonObject {
        put("type", "isPlaybackComplete")
        put("positionMs", positionMs)
        put("durationMs", durationMs)
    }).jsonPrimitive.boolean
}

internal fun preserveNewerLocalProgress(
    local: ProgressSummary,
    server: ProgressSummary,
): ProgressSummary = when {
    local.watched && !server.watched -> local
    local.positionMs > server.positionMs -> local
    local.continueWatching && !server.continueWatching -> local
    else -> server
}

internal fun isProgressCheckpointAccepted(
    checkpoint: ProgressSummary,
    server: ProgressSummary,
): Boolean =
    server.positionMs >= checkpoint.positionMs &&
        (!checkpoint.watched || server.watched) &&
        (!checkpoint.continueWatching || server.continueWatching) &&
        (checkpoint.playbackSource == null || checkpoint.playbackSource == server.playbackSource)
