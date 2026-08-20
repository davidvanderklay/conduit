package media.conduit.mobile

import media.conduit.mobile.account.StreamSource
import media.conduit.mobile.account.VideoItem

data class StreamAddonChoice(
    val id: String,
    val name: String,
)

data class PlaybackStreamPickerState(
    val episode: VideoItem,
    val movie: Boolean = false,
    val streams: List<StreamSource> = emptyList(),
    val addonChoices: List<StreamAddonChoice> = emptyList(),
    val selectedAddonId: String? = null,
    val resumeFrom: String? = null,
    val loading: Boolean = false,
    val error: String? = null,
)
