package media.conduit.mobile

import media.conduit.mobile.account.PlaybackSource

internal enum class MediaOpenMode {
    Details,
    AutoResume,
}

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
