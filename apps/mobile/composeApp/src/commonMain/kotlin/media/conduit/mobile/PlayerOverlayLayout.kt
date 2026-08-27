package media.conduit.mobile

internal const val COMPACT_PLAYER_ACTION_BOTTOM_PADDING_DP = 132
internal const val TABLET_PLAYER_ACTION_BOTTOM_PADDING_DP = 132
internal const val PLAYER_ACTION_BOTTOM_PADDING_DP = 102

/** Keeps action prompts in the slot above the transport controls. */
internal fun playerActionBottomPaddingDp(
    controlsVisible: Boolean,
    compactUpNext: Boolean,
    isTablet: Boolean = false,
): Int = when {
    compactUpNext -> COMPACT_PLAYER_ACTION_BOTTOM_PADDING_DP
    isTablet -> TABLET_PLAYER_ACTION_BOTTOM_PADDING_DP
    else -> PLAYER_ACTION_BOTTOM_PADDING_DP
}
