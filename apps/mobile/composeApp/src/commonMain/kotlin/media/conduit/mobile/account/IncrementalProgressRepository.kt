package media.conduit.mobile.account

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import media.conduit.mobile.progressdb.ProgressDatabase
import kotlin.math.min
import kotlin.time.Clock
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

private const val ProgressDrainBatchSize = 25L
private const val MaxProgressAttempts = 8L
private const val RetryBaseMs = 5_000L
private const val RetryCapMs = 60 * 60_000L

data class ProgressSyncDiagnostic(
    val operationId: String,
    val type: String,
    val attemptCount: Long,
    val nextAttemptAt: Long,
    val lastError: String?,
    val failed: Boolean,
)

/** Owns the server-derived progress projection, delta cursor, and durable operation outbox. */
class IncrementalProgressRepository(
    private val api: ConduitApi,
    private val database: ProgressDatabase,
) {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
        classDiscriminator = "type"
    }
    private val mutex = Mutex()
    private val queries = database.progressQueries

    suspend fun synchronize(baseUrl: String, token: String, accountId: String, profileId: String): List<ProgressSummary> = mutex.withLock {
        val scope = scopeKey(baseUrl, accountId, profileId)
        drain(scope, baseUrl, token, profileId)
        val state = queries.selectScope(scope).executeAsOneOrNull()
        runCatching {
            if (state?.initialized != 1L) bootstrap(scope, baseUrl, token, profileId)
            else consumeChanges(scope, baseUrl, token, profileId, state.generation, state.cursor)
        }.recoverCatching { cause ->
            if (cause is CancellationException) throw cause
            if ((cause as? ServerRequestException)?.statusCode == 409) bootstrap(scope, baseUrl, token, profileId)
        }
        overlay(scope)
    }

    suspend fun fullResync(baseUrl: String, token: String, accountId: String, profileId: String): List<ProgressSummary> = mutex.withLock {
        val scope = scopeKey(baseUrl, accountId, profileId)
        drain(scope, baseUrl, token, profileId)
        runCatching { bootstrap(scope, baseUrl, token, profileId) }
            .onFailure { if (it is CancellationException) throw it }
        overlay(scope)
    }

    @OptIn(ExperimentalUuidApi::class)
    suspend fun enqueue(
        baseUrl: String,
        accountId: String,
        profileId: String,
        operation: ProgressOperation,
    ): String = mutex.withLock {
        val scope = scopeKey(baseUrl, accountId, profileId)
        val operationId = Uuid.random().toString()
        val createdAt = Clock.System.now().toEpochMilliseconds()
        val titleKey = titleKey(operation.identity)
        val episodeKey = episodeKey(operation.identity)
        database.transaction {
            when (operation) {
                is ProgressOperation.DismissTitle,
                is ProgressOperation.RestoreTitle,
                is ProgressOperation.DeleteTitle -> queries.deleteOlderTitleOperations(scope, titleKey, createdAt)
                is ProgressOperation.DeleteEpisode -> queries.deleteOlderEpisodeOperations(scope, episodeKey, createdAt)
                is ProgressOperation.Upsert -> Unit
            }
            queries.insertOperation(
                scope,
                operationId,
                operationType(operation),
                titleKey,
                episodeKey,
                json.encodeToString<ProgressOperation>(operation),
                createdAt,
            )
        }
        operationId
    }

    suspend fun diagnostics(baseUrl: String, accountId: String, profileId: String): List<ProgressSyncDiagnostic> = mutex.withLock {
        queries.selectOperations(scopeKey(baseUrl, accountId, profileId)).executeAsList().map {
            ProgressSyncDiagnostic(it.operation_id, it.operation_type, it.attempt_count, it.next_attempt_at, it.last_error, it.failed == 1L)
        }
    }

    suspend fun retry(baseUrl: String, accountId: String, profileId: String, operationId: String) = mutex.withLock {
        queries.retryOperation(scopeKey(baseUrl, accountId, profileId), operationId)
    }

    suspend fun discard(baseUrl: String, accountId: String, profileId: String, operationId: String) = mutex.withLock {
        queries.discardOperation(scopeKey(baseUrl, accountId, profileId), operationId)
    }

    private suspend fun drain(scope: String, baseUrl: String, token: String, profileId: String) {
        val now = Clock.System.now().toEpochMilliseconds()
        val candidates = queries.selectDueOperations(scope, now, ProgressDrainBatchSize).executeAsList()
        for (candidate in candidates) {
            val operation = runCatching { json.decodeFromString<ProgressOperation>(candidate.payload) }.getOrElse { cause ->
                queries.recordRetry(candidate.attempt_count + 1, Long.MAX_VALUE, "Invalid persisted operation: ${cause.message}", 1L, scope, candidate.operation_id)
                continue
            }
            try {
                api.applyProgressOperation(baseUrl, token, profileId, candidate.operation_id, operation)
                queries.deleteOperation(scope, candidate.operation_id)
            } catch (cause: Throwable) {
                if (cause is CancellationException) throw cause
                val attempts = candidate.attempt_count + 1
                val permanent = (cause as? ServerRequestException)?.statusCode?.let { it in 400..499 && it !in setOf(408, 429) } == true
                val failed = permanent || attempts >= MaxProgressAttempts
                val delay = min(RetryCapMs, RetryBaseMs * (1L shl min(16, attempts.toInt() - 1)))
                queries.recordRetry(attempts, if (failed) Long.MAX_VALUE else now + delay, cause.message, if (failed) 1L else 0L, scope, candidate.operation_id)
            }
        }
    }

    private suspend fun bootstrap(scope: String, baseUrl: String, token: String, profileId: String) {
        var boundary: Long? = null
        var generation: Long? = null
        var afterVideoId: String? = null
        val items = mutableListOf<ProgressSummary>()
        do {
            val page = api.progressSnapshotPage(baseUrl, token, profileId, boundary, generation, afterVideoId)
            boundary = page.boundary
            generation = page.generation
            items += page.items
            afterVideoId = page.nextAfterVideoId
        } while (afterVideoId != null)
        database.transaction {
            queries.clearProjection(scope)
            items.forEach { item -> putProjection(scope, item) }
            queries.upsertScope(scope, checkNotNull(generation), checkNotNull(boundary), 1L)
        }
        consumeChanges(scope, baseUrl, token, profileId, checkNotNull(generation), checkNotNull(boundary))
    }

    private suspend fun consumeChanges(scope: String, baseUrl: String, token: String, profileId: String, generation: Long, initialCursor: Long) {
        var cursor = initialCursor
        do {
            val page = api.progressChanges(baseUrl, token, profileId, generation, cursor)
            database.transaction {
                page.events.forEach { event -> applyEvent(scope, event) }
                queries.upsertScope(scope, generation, page.nextCursor, 1L)
            }
            cursor = page.nextCursor
        } while (page.hasMore)
    }

    private fun applyEvent(scope: String, event: ProgressEvent) {
        val payload = event.payload
        when (payload["kind"]?.toString()?.trim('"')) {
            "upsert" -> putProjection(scope, json.decodeFromJsonElement(payload.getValue("item")))
            "deleteEpisode" -> {
                val titleId = payload["canonicalTitleId"]?.toString()?.trim('"') ?: return
                val episode = payload["canonicalEpisodeKey"]?.toString()?.trim('"') ?: return
                queries.deleteEpisodeProjection(scope, titleId, episode)
            }
            "deleteTitle" -> payload["canonicalTitleId"]?.toString()?.trim('"')?.let { queries.deleteTitleProjection(scope, it) }
            "dismissTitle", "restoreTitle" -> {
                val titleId = payload["canonicalTitleId"]?.toString()?.trim('"') ?: return
                val dismissed = payload["kind"]?.toString()?.contains("dismissTitle") == true
                queries.selectProjectionByTitle(scope, titleId).executeAsList().forEach { row ->
                    val item = json.decodeFromString<ProgressSummary>(row.payload).copy(dismissed = dismissed, revision = event.revision)
                    queries.upsertProjection(scope, row.canonical_episode_key, titleId, event.revision, json.encodeToString(item))
                }
            }
        }
    }

    private fun putProjection(scope: String, item: ProgressSummary) {
        val titleId = item.canonicalTitleId ?: "legacy:${item.mediaType}:${item.mediaId}"
        val episode = item.canonicalEpisodeKey ?: episodeCoordinate(item.identity())
        val key = "$titleId\u001f$episode"
        queries.upsertProjection(scope, key, titleId, item.revision, json.encodeToString(item))
    }

    private fun overlay(scope: String): List<ProgressSummary> {
        val projection = linkedMapOf<String, ProgressSummary>()
        queries.selectProjection(scope).executeAsList().forEach { payload ->
            val item = json.decodeFromString<ProgressSummary>(payload)
            projection[projectionKey(item)] = item
        }
        queries.selectOperations(scope).executeAsList().filter { it.failed == 0L }.forEach { row ->
            when (val operation = json.decodeFromString<ProgressOperation>(row.payload)) {
                is ProgressOperation.Upsert -> {
                    projection.keys.filter { key -> sameEpisode(projection.getValue(key), operation.identity) }.forEach(projection::remove)
                    projection[episodeKey(operation.identity)] = operation.toSummary()
                }
                is ProgressOperation.DeleteEpisode -> projection.remove(episodeKey(operation.identity))
                is ProgressOperation.DeleteTitle -> projection.keys.filter { key -> titleKey(projection.getValue(key).identity()) == titleKey(operation.identity) }.forEach(projection::remove)
                is ProgressOperation.DismissTitle -> projection.keys.toList().forEach { key -> projection[key] = projection.getValue(key).let { if (titleKey(it.identity()) == titleKey(operation.identity)) it.copy(dismissed = true) else it } }
                is ProgressOperation.RestoreTitle -> projection.keys.toList().forEach { key -> projection[key] = projection.getValue(key).let { if (titleKey(it.identity()) == titleKey(operation.identity)) it.copy(dismissed = false) else it } }
            }
        }
        return projection.values.toList()
    }
}

private fun scopeKey(baseUrl: String, accountId: String, profileId: String): String = listOf(baseUrl, accountId, profileId).joinToString("\u001f") { "${it.length}:$it" }
private fun titleKey(identity: ProgressIdentity): String = identity.canonicalTitleId?.let { "canonical:$it" }
    ?: "${identity.mediaType}\u001f${(identity.aliases + identity.mediaId).distinct().sorted().joinToString("\u001e")}" 
private fun episodeCoordinate(identity: ProgressIdentity): String = if (identity.season == null && identity.episode == null) "movie" else "s${identity.season ?: 0}:e${identity.episode ?: 0}"
private fun episodeKey(identity: ProgressIdentity): String = "${titleKey(identity)}\u001f${episodeCoordinate(identity)}"
private fun projectionKey(item: ProgressSummary): String = "${item.canonicalTitleId ?: titleKey(item.identity())}\u001f${item.canonicalEpisodeKey ?: episodeCoordinate(item.identity())}"
private fun sameEpisode(item: ProgressSummary, identity: ProgressIdentity): Boolean =
    item.mediaType == identity.mediaType && item.mediaId in (identity.aliases + identity.mediaId) &&
        item.season == identity.season && item.episode == identity.episode
private fun operationType(operation: ProgressOperation): String = when (operation) {
    is ProgressOperation.Upsert -> "upsert"
    is ProgressOperation.DismissTitle -> "dismissTitle"
    is ProgressOperation.RestoreTitle -> "restoreTitle"
    is ProgressOperation.DeleteEpisode -> "deleteEpisode"
    is ProgressOperation.DeleteTitle -> "deleteTitle"
}
private fun ProgressSummary.identity() = ProgressIdentity(canonicalTitleId = canonicalTitleId, mediaType = mediaType, mediaId = mediaId, videoId = videoId, season = season, episode = episode)
private fun ProgressOperation.Upsert.toSummary() = ProgressSummary(
    videoId = identity.videoId ?: error("Upsert requires videoId"), mediaType = identity.mediaType, mediaId = identity.mediaId,
    name = name, poster = poster, videoTitle = videoTitle, season = identity.season, episode = identity.episode,
    positionMs = positionMs, durationMs = durationMs, watched = watched, continueWatching = true,
    playbackSource = playbackSource, updatedAt = Clock.System.now().toString(),
)
