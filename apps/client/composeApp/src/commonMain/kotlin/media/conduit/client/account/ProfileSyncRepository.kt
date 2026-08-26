package media.conduit.client.account

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.client.foundation.SecureStore
import media.conduit.client.foundation.SettingsStore

data class ProfileSyncState(
    val snapshot: ProfileSnapshot? = null,
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val error: String? = null,
)

internal fun profileSyncFailureState(snapshot: ProfileSnapshot?, cause: Throwable): ProfileSyncState =
    ProfileSyncState(
        snapshot = snapshot,
        offline = snapshot != null,
        error = cause.message ?: "Unable to synchronize this profile",
    )

internal fun ProfileSnapshot.withProgressUpdate(update: ProgressSummary): ProfileSnapshot =
    withProgressUpdates(listOf(update))

internal fun ProfileSnapshot.withProgressUpdates(updates: Collection<ProgressSummary>): ProfileSnapshot {
    if (updates.isEmpty()) return this

    fun merge(items: List<ProgressSummary>): List<ProgressSummary> {
        val merged = linkedMapOf<String, ProgressSummary>()
        (items + updates).forEach { item ->
            val current = merged[item.videoId]
            if (current == null || item.updatedAt >= current.updatedAt) merged[item.videoId] = item
        }
        return merged.values.sortedWith(compareByDescending<ProgressSummary> { it.updatedAt }.thenByDescending { it.revision })
    }

    return copy(
        progress = merge(progress),
        history = merge(history),
        continueWatching = latestProgressByTitle(
            merge(continueWatching).filter { it.continueWatching && !it.dismissed },
        ),
    )
}

class ProfileSyncRepository(
    private val api: ConduitApi,
    private val secureStore: SecureStore,
    private val scope: String = "legacy",
    private val profileCache: SettingsStore? = null,
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun cached(profileId: String): ProfileSnapshot? = readCache(cacheKey(profileId))
        ?.let { runCatching { json.decodeFromString<ProfileSnapshot>(it) }.getOrNull() }
        ?.let { snapshot ->
            // Snapshots written before history had its own field stored history rows in progress.
            if (snapshot.history.isEmpty() && snapshot.progress.isNotEmpty()) snapshot.copy(history = snapshot.progress) else snapshot
        }

    suspend fun synchronize(
        baseUrl: String,
        token: String,
        profileId: String,
        preservedProgress: Collection<ProgressSummary> = emptyList(),
        progressOverride: List<ProgressSummary>? = null,
    ): ProfileSyncState {
        val cached = cached(profileId)
        return try {
            pendingQueue(profileId)?.let { pending ->
                api.replaceQueue(baseUrl, token, profileId, pending)
                clearPendingQueue(profileId)
            }
            val snapshot = api.synchronizeProfile(baseUrl, token, profileId, progressOverride)
                .withProgressUpdates(preservedProgress)
            writeCache(cacheKey(profileId), json.encodeToString(snapshot))
            ProfileSyncState(snapshot = snapshot)
        } catch (cause: Exception) {
            val offlineSnapshot = cached?.let { snapshot ->
                progressOverride?.let { progress ->
                    snapshot.copy(
                        progress = progress,
                        history = progress,
                        continueWatching = latestProgressByTitle(
                            progress.filter { it.continueWatching && !it.dismissed },
                        ),
                    )
                } ?: snapshot.withProgressUpdates(preservedProgress)
            } ?: preservedProgress.takeIf { it.isNotEmpty() }?.let { progress ->
                ProfileSnapshot(
                    profileId = profileId,
                    addons = emptyList(),
                    library = emptyList(),
                    progress = progress.toList(),
                    history = progress.toList(),
                    continueWatching = latestProgressByTitle(
                        progress.filter { it.continueWatching && !it.dismissed },
                    ),
                )
            }
            ProfileSyncState(
                snapshot = offlineSnapshot,
                offline = cached != null || offlineSnapshot != null,
                error = cause.message ?: "Unable to synchronize this profile",
            )
        }
    }

    fun save(snapshot: ProfileSnapshot) {
        writeCache(cacheKey(snapshot.profileId), json.encodeToString(snapshot))
    }

    fun savePendingQueue(profileId: String, items: List<PlaybackQueueItem>) {
        secureStore.put(pendingQueueKey(profileId), json.encodeToString(items))
    }

    fun pendingQueue(profileId: String): List<PlaybackQueueItem>? = secureStore.get(pendingQueueKey(profileId))
        ?.let { runCatching { json.decodeFromString<List<PlaybackQueueItem>>(it) }.getOrNull() }

    fun clearPendingQueue(profileId: String) = secureStore.remove(pendingQueueKey(profileId))

    fun clear(profileId: String) = removeCache(cacheKey(profileId))

    private fun cacheKey(profileId: String) = "profile.snapshot.v2.${scope.length}:$scope.$profileId"
    private fun pendingQueueKey(profileId: String) = "profile.queue.pending.v2.${scope.length}:$scope.$profileId"

    private fun readCache(key: String): String? = profileCache?.get(key) ?: secureStore.get(key)

    private fun writeCache(key: String, value: String) {
        if (profileCache != null) profileCache.put(key, value) else secureStore.put(key, value)
    }

    private fun removeCache(key: String) {
        profileCache?.remove(key)
        secureStore.remove(key)
    }
}
