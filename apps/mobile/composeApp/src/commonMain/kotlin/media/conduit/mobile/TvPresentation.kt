package media.conduit.mobile

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import media.conduit.mobile.account.AccountStatus
import media.conduit.mobile.account.AuthenticationConfiguration
import media.conduit.mobile.account.CatalogItem
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.account.MetaItem
import media.conduit.mobile.account.PlaybackQueueItem
import media.conduit.mobile.account.ProfileMutation
import media.conduit.mobile.account.ProfileSnapshot
import media.conduit.mobile.account.ProfileSummary
import media.conduit.mobile.account.ProfileSyncState
import media.conduit.mobile.account.StreamSource
import media.conduit.mobile.account.TvPairing
import media.conduit.mobile.account.VideoItem
import media.conduit.mobile.foundation.AppAction
import media.conduit.mobile.foundation.AppState
import media.conduit.mobile.foundation.DevicePreferences
import media.conduit.mobile.foundation.PlatformInfo
import media.conduit.mobile.foundation.ServerEndpoint

/**
 * Render points that Android TV replaces with a D-pad presentation. The shared
 * composables keep owning account, sync, stream, and playback logic and hand the
 * resulting state here. Phones and iOS leave [LocalTvPresentation] unset.
 */
internal interface TvPresentation {
    @Composable fun ServerSetup(state: AppState, dispatch: (AppAction) -> Unit)
    @Composable fun SignIn(model: TvSignInModel)
    @Composable fun HouseholdSetup(onCreate: (household: String, profile: String) -> Unit)
    @Composable fun RecoveryCodes(codes: List<String>, onSaved: () -> Unit)
    @Composable fun ConnectionError(message: String, onRetry: () -> Unit, onChangeServer: () -> Unit)
    @Composable fun Shell(model: TvShellModel)
    @Composable fun Details(model: TvDetailsModel)
    @Composable fun PlayerOverlays(scope: BoxScope, model: TvPlayerModel)

    /** A scannable code for handing a link to a phone, where a TV has no clipboard or share sheet. */
    @Composable fun QrCode(text: String, modifier: Modifier)
}

internal val LocalTvPresentation = staticCompositionLocalOf<TvPresentation?> { null }

internal class TvSignInModel(
    val endpoint: ServerEndpoint,
    val authentication: AuthenticationConfiguration,
    val error: String?,
    val authenticationLoading: Boolean,
    val authenticationReady: Boolean,
    val authenticationError: String?,
    val onRetryAuthentication: () -> Unit,
    val onSignIn: (email: String, password: String) -> Unit,
    val onRegister: (email: String, password: String) -> Unit,
    val onRecover: (email: String, code: String, password: String) -> Unit,
    val serverError: String?,
    val serverPending: Boolean,
    val onConnectServer: (String) -> Unit,
    /** Starts a sign-in that is approved from a phone browser. */
    val onStartPairing: suspend () -> TvPairing,
    /** Returns true once the phone approved and this device is signed in. */
    val onPollPairing: suspend (TvPairing) -> Boolean,
)

/** Signed-in session state and navigation callbacks owned by the shared app shell. */
internal class TvShellModel(
    val state: AppState,
    val platform: PlatformInfo,
    val account: AccountStatus.SignedIn,
    val profiles: List<ProfileSummary>,
    val activeProfile: ProfileSummary?,
    val sync: ProfileSyncState,
    val api: ConduitApi,
    val preferences: DevicePreferences,
    val onPreferencesChanged: (DevicePreferences) -> Unit,
    val homeCache: HomeScreenCache,
    val notices: SnackbarHostState,
    val playbackSession: PlaybackSessionController,
    val detailsOpen: Boolean,
    /** The shared details screen for the selected title; it renders through [TvPresentation.Details]. */
    val details: @Composable () -> Unit,
    val browseQuery: String,
    val onBrowseQueryChange: (String) -> Unit,
    val discoverSelection: DiscoverSelection,
    val onDiscoverSelectionChange: (DiscoverSelection) -> Unit,
    val onOpenMedia: (CatalogItem, videoId: String?) -> Unit,
    val onResume: (CatalogItem, videoId: String?) -> Unit,
    val onOpenResumeDetails: (CatalogItem) -> Unit,
    val onPlayQueued: (PlaybackQueueItem) -> Unit,
    val onMutation: suspend (ProfileMutation) -> Result<Unit>,
    val onRefresh: () -> Unit,
    val dispatch: (AppAction) -> Unit,
    val onSignOut: () -> Unit,
    val onProfilesChanged: (selectedProfileId: String?) -> Unit,
    val shareText: (String) -> Unit,
    /** Null when watch parties are unavailable for this session. */
    val onWatchParty: (() -> Unit)?,
    /** True while a shared overlay (the watch party panel) covers the shell. */
    val overlayOpen: Boolean,
)

internal class TvStreamsModel(
    val episode: VideoItem?,
    val streams: List<StreamSource>,
    val addonChoices: List<StreamAddonChoice>,
    val selectedAddonId: String?,
    val resumeFrom: String?,
    val loading: Boolean,
    val error: String?,
    val onSelectAddon: (String?) -> Unit,
    val onRetry: () -> Unit,
    val onSelect: (StreamSource) -> Unit,
)

internal class TvDetailsModel(
    val item: CatalogItem,
    val meta: MetaItem?,
    val error: String?,
    val snapshot: ProfileSnapshot?,
    val saved: Boolean,
    val playLabel: String,
    /** The episode the play button targets; null for movies. */
    val playVideoId: String?,
    val onPlay: () -> Unit,
    val seasons: List<Int>,
    val selectedSeason: Int?,
    val onSelectSeason: (Int) -> Unit,
    val onSelectEpisode: (VideoItem) -> Unit,
    /** Non-null while the stream list for a movie or episode is open. */
    val streams: TvStreamsModel?,
    /** Non-null while a saved source is resolving or playback is starting. */
    val openingStatus: String?,
    val onMutation: suspend (ProfileMutation) -> Result<Unit>,
    val onBrowse: (MobileBrowseTarget) -> Unit,
    /** Steps back one level: closes streams, cancels opening, or leaves details. */
    val onBack: () -> Unit,
)

internal class TvPlayerModel(
    val controller: PlaybackSessionController,
    val session: PlaybackSessionState,
    val request: PlaybackRequest,
    val snapshot: ProfileSnapshot?,
    val onMutation: suspend (ProfileMutation) -> Result<Unit>,
    /** Cover shown while a stream resolves or loads its first frame. */
    val openingTitle: String?,
    val openingArtwork: String?,
    val openingLogo: String?,
    val openingStatus: String?,
    val opening: Boolean,
    val buffering: Boolean,
    val error: String?,
    /** Non-null while the up-next banner is due. */
    val upNext: PlaybackUpNext?,
    val onDismissUpNext: () -> Unit,
    val hasNext: Boolean,
    /** Non-null while a skippable intro, recap, or outro is playing. */
    val skip: SkipSegment?,
    val engine: PlayerEngineBridge,
    val onWatchParty: (() -> Unit)?,
    /** True while the watch party panel covers the player and holds focus. */
    val overlayOpen: Boolean,
    val onControlsVisibilityChanged: (Boolean) -> Unit,
    val onClose: () -> Unit,
)

/**
 * Controls only the native player can perform. On Android TV the session host
 * owns the control bar, so the player publishes these for the host to call and
 * leaves its own touch controls out.
 */
internal class PlayerEngineBridge {
    var openAudio: () -> Unit = {}
    var openSubtitles: () -> Unit = {}
    var cycleSpeed: () -> Unit = {}
    var cycleScale: () -> Unit = {}
    var speedLabel by mutableStateOf("1.0×")
    var scaleLabel by mutableStateOf("Fit")
    /** True while the audio or subtitle panel is open and holds focus. */
    var panelOpen by mutableStateOf(false)
}

internal val LocalPlayerEngineBridge = staticCompositionLocalOf<PlayerEngineBridge?> { null }
