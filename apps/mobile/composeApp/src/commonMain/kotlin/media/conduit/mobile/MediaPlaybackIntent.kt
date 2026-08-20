package media.conduit.mobile

import media.conduit.mobile.account.PlaybackSource

internal enum class MediaOpenMode {
    Details,
    AutoResume,
    Queue,
}

internal data class MediaDetailsInstanceKey(
    val mediaType: String,
    val mediaId: String,
    val videoId: String?,
    val openMode: MediaOpenMode,
)

internal fun shouldAutoResume(
    openMode: MediaOpenMode,
    autoSelectSavedStreams: Boolean,
    savedSource: PlaybackSource?,
): Boolean = openMode == MediaOpenMode.AutoResume && autoSelectSavedStreams && savedSource != null

internal fun shouldOpenStreamSelectionImmediately(
    openMode: MediaOpenMode,
    autoSelectSavedStreams: Boolean,
    savedSource: PlaybackSource?,
): Boolean = openMode == MediaOpenMode.AutoResume && !shouldAutoResume(
    openMode,
    autoSelectSavedStreams,
    savedSource,
)
