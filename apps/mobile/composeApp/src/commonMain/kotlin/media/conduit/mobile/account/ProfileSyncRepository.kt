package media.conduit.mobile.account

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.foundation.SecureStore

data class ProfileSyncState(
    val snapshot: ProfileSnapshot? = null,
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val error: String? = null,
)

internal fun ProfileSnapshot.withProgressUpdate(update: ProgressSummary): ProfileSnapshot {
    fun merge(items: List<ProgressSummary>): List<ProgressSummary> =
        (listOf(update) + items.filterNot { it.videoId == update.videoId })
            .sortedByDescending(ProgressSummary::updatedAt)

    return copy(
        progress = merge(this.progress),
        history = merge(history),
        continueWatching = if (update.continueWatching && !update.dismissed) {
            merge(continueWatching)
        } else {
            continueWatching.filterNot { it.videoId == update.videoId }
        },
    )
}

class ProfileSyncRepository(
    private val api: ConduitApi,
    private val secureStore: SecureStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun cached(profileId: String): ProfileSnapshot? = secureStore.get(cacheKey(profileId))
        ?.let { runCatching { json.decodeFromString<ProfileSnapshot>(it) }.getOrNull() }
        ?.let { snapshot ->
            // Snapshots written before history had its own field stored history rows in progress.
            if (snapshot.history.isEmpty() && snapshot.progress.isNotEmpty()) snapshot.copy(history = snapshot.progress) else snapshot
        }

    suspend fun synchronize(baseUrl: String, token: String, profileId: String): ProfileSyncState {
        val cached = cached(profileId)
        return try {
            val snapshot = api.synchronizeProfile(baseUrl, token, profileId)
            secureStore.put(cacheKey(profileId), json.encodeToString(snapshot))
            ProfileSyncState(snapshot = snapshot)
        } catch (cause: Exception) {
            ProfileSyncState(
                snapshot = cached,
                offline = cached != null,
                error = cause.message ?: "Unable to synchronize this profile",
            )
        }
    }

    fun save(snapshot: ProfileSnapshot) {
        secureStore.put(cacheKey(snapshot.profileId), json.encodeToString(snapshot))
    }

    fun clear(profileId: String) = secureStore.remove(cacheKey(profileId))

    private fun cacheKey(profileId: String) = "profile.snapshot.v1.$profileId"
}
