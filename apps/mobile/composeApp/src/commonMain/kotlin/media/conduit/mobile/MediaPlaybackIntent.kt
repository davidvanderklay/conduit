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

/**
 * Initial automatic stream resolution must not compete with an explicit
 * playback transition such as Next. A pending intent created by the owning
 * screen may resolve once; transitions owned elsewhere must not compete.
 */
internal fun shouldRunAutomaticStreamResolution(
    openMode: MediaOpenMode,
    addonsAvailable: Boolean,
    transitionActive: Boolean,
    transitionOwnedByTarget: Boolean = false,
): Boolean = openMode != MediaOpenMode.Details && addonsAvailable &&
    (!transitionActive || transitionOwnedByTarget)
