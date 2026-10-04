package media.conduit.mobile.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import media.conduit.mobile.PlatformBackHandler
import media.conduit.mobile.PlaybackPresentation
import media.conduit.mobile.TvShellModel
import media.conduit.mobile.account.ProfileSummary
import media.conduit.mobile.foundation.AppAction
import media.conduit.mobile.foundation.AppDestination
import media.conduit.mobile.foundation.ConduitMark
import media.conduit.mobile.profileColor

private data class TvRailEntry(val destination: AppDestination, val label: String, val icon: ImageVector)

private val railEntries = listOf(
    TvRailEntry(AppDestination.Home, "Home", Icons.Rounded.Home),
    TvRailEntry(AppDestination.Search, "Discover", Icons.Rounded.Explore),
    TvRailEntry(AppDestination.Library, "Library", Icons.Rounded.VideoLibrary),
    TvRailEntry(AppDestination.Profile, "Settings", Icons.Rounded.Settings),
)

/** Screens without their own rail entry highlight the entry they were opened from. */
private fun AppDestination.railOwner(): AppDestination = when (this) {
    AppDestination.ContinueWatching -> AppDestination.Home
    AppDestination.Calendar -> AppDestination.Library
    else -> this
}

/**
 * The signed-in TV frame: a left rail, the active destination, and the details
 * page layered above. Only the top layer accepts D-pad focus, and each layer
 * gets its previous focus back when the one above it closes.
 */
@Composable
internal fun TvShell(model: TvShellModel) {
    val destination = model.state.destination
    val playerOpen = model.playbackSession.state.presentation != PlaybackPresentation.Closed
    val railFocus = remember { FocusRequester() }
    val railSelection = remember { FocusRequester() }
    val contentFocus = remember { FocusRequester() }
    var railFocused by remember { mutableStateOf(false) }
    var profilesOpen by remember { mutableStateOf(false) }
    val memories = remember(model.activeProfile?.id) { AppDestination.entries.associateWith { TvFocusMemory() } }
    val memory = memories.getValue(destination)
    var queueOpen by remember { mutableStateOf(false) }
    val covered = model.detailsOpen || playerOpen || profilesOpen || queueOpen || model.overlayOpen

    LaunchedEffect(covered, destination) {
        if (!covered && !railFocused && !memory.restore()) contentFocus.requestFocusWhenReady()
    }
    PlatformBackHandler(
        enabled = !covered && (!railFocused || destination != AppDestination.Home),
        onBack = {
            if (!railFocused) railFocus.requestFocus()
            else model.dispatch(AppAction.Navigate(AppDestination.Home))
        },
    )

    CompositionLocalProvider(LocalTvPlayerOpen provides playerOpen, LocalContentColor provides Color.White) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            Box(Modifier.fillMaxSize().tvFocusBlocked(covered)) {
                Box(Modifier.fillMaxSize().focusRequester(contentFocus).focusGroup()) {
                    when (destination) {
                        AppDestination.Home, AppDestination.ContinueWatching -> TvHome(model, memory, active = !covered)
                        AppDestination.Search -> TvDiscover(model, memory)
                        AppDestination.Library, AppDestination.Calendar -> TvLibrary(model, memory, active = !covered)
                        AppDestination.Profile -> TvSettings(model, memory, active = !covered)
                    }
                }
                TvRail(
                    selected = destination.railOwner(),
                    profile = model.activeProfile,
                    expanded = railFocused,
                    onSelect = { model.dispatch(AppAction.Navigate(it)) },
                    onProfiles = { profilesOpen = true },
                    selectedFocus = railSelection,
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .onFocusChanged { railFocused = it.hasFocus }
                        // Right always leaves the rail for the page: its last focused item, or its first.
                        .onPreviewKeyEvent { event ->
                            if (event.key != Key.DirectionRight) return@onPreviewKeyEvent false
                            if (event.type == KeyEventType.KeyDown && !memory.restore()) contentFocus.requestFocus()
                            true
                        }
                        .focusRequester(railFocus)
                        // Entering the rail lands on the current destination, not the nearest icon.
                        .focusRestorer(railSelection)
                        .focusGroup(),
                )
            }
            if (model.detailsOpen) {
                Box(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                        .tvFocusBlocked(playerOpen || model.overlayOpen)
                        .tvFocusTrap(enabled = !playerOpen && !model.overlayOpen),
                ) { model.details() }
            }
            if (profilesOpen) {
                TvProfilePicker(
                    profiles = model.profiles,
                    active = model.activeProfile,
                    onSelect = { profile ->
                        profilesOpen = false
                        model.dispatch(AppAction.SelectProfile(profile.id))
                    },
                    onDismiss = { profilesOpen = false },
                    queueCount = model.sync.snapshot?.queue?.size ?: 0,
                    onQueue = { profilesOpen = false; queueOpen = true },
                    onWatchParty = model.onWatchParty?.let { open -> { profilesOpen = false; open() } },
                )
            }
            if (queueOpen) {
                TvQueueDrawer(
                    model = model,
                    onClose = { queueOpen = false },
                )
            }
            SnackbarHost(model.notices, Modifier.align(Alignment.BottomCenter).padding(bottom = TvSpacing.Edge)) { data ->
                Text(
                    data.visuals.message,
                    color = Color.White,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier
                        .background(Color(0xF018181B), RoundedCornerShape(10.dp))
                        .border(1.dp, TvColors.Hairline, RoundedCornerShape(10.dp))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun TvRail(
    selected: AppDestination,
    profile: ProfileSummary?,
    expanded: Boolean,
    onSelect: (AppDestination) -> Unit,
    onProfiles: () -> Unit,
    selectedFocus: FocusRequester,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxHeight()
            .width(if (expanded) 200.dp else TvSpacing.Rail)
            .background(
                if (expanded) {
                    Brush.horizontalGradient(listOf(Color(0xFA09090B), Color(0xE609090B), Color.Transparent))
                } else {
                    Brush.horizontalGradient(listOf(Color(0x9909090B), Color.Transparent))
                },
            )
            .padding(start = 14.dp, top = TvSpacing.Edge, bottom = TvSpacing.Edge),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ConduitMark(Modifier.padding(start = 6.dp).size(36.dp))
        Spacer(Modifier.weight(1f))
        railEntries.forEach { entry ->
            TvRailItem(
                label = entry.label,
                selected = entry.destination == selected,
                expanded = expanded,
                onClick = { onSelect(entry.destination) },
                modifier = if (entry.destination == selected) Modifier.focusRequester(selectedFocus) else Modifier,
            ) { tint -> Icon(entry.icon, null, tint = tint, modifier = Modifier.size(24.dp)) }
        }
        Spacer(Modifier.weight(1f))
        TvRailItem(
            label = profile?.name ?: "Profiles",
            selected = false,
            expanded = expanded,
            onClick = onProfiles,
        ) { TvAvatar(profile, 28.dp) }
    }
}

@Composable
private fun TvRailItem(
    label: String,
    selected: Boolean,
    expanded: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: @Composable (tint: Color) -> Unit,
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        container = { focused ->
            when {
                focused -> TvColors.ControlFocused
                selected -> TvColors.Amber.copy(alpha = .15f)
                else -> Color.Transparent
            }
        },
    ) {
        Row(
            Modifier.height(48.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val tint = if (selected) TvColors.AmberSoft else Color.White
            icon(tint)
            if (expanded) {
                Text(label, color = tint, fontWeight = FontWeight.SemiBold, maxLines = 1, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
internal fun TvAvatar(profile: ProfileSummary?, size: Dp, modifier: Modifier = Modifier) {
    val color = profile?.avatarColor?.let(::profileColor) ?: MaterialTheme.colorScheme.primary
    Box(modifier.size(size).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
        if (!profile?.avatarUrl.isNullOrBlank()) {
            AsyncImage(profile?.avatarUrl, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Text(
                profile?.name?.take(1)?.uppercase() ?: "P",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                style = if (size >= 56.dp) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Composable
private fun TvProfilePicker(
    profiles: List<ProfileSummary>,
    active: ProfileSummary?,
    onSelect: (ProfileSummary) -> Unit,
    onDismiss: () -> Unit,
    queueCount: Int,
    onQueue: () -> Unit,
    onWatchParty: (() -> Unit)?,
) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocusWhenReady() }
    PlatformBackHandler(onBack = onDismiss)
    Column(
        Modifier.fillMaxSize().background(Color(0xF509090B)).tvFocusTrap(),
        verticalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Who is watching?", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            profiles.forEach { profile ->
                TvFocusable(
                    onClick = { onSelect(profile) },
                    shape = RoundedCornerShape(16.dp),
                    modifier = if (profile.id == (active ?: profiles.firstOrNull())?.id) Modifier.focusRequester(first) else Modifier,
                ) {
                    Column(
                        Modifier.padding(14.dp).width(96.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        TvAvatar(profile, 80.dp)
                        Text(profile.name, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        if (profile.isKids) Text("Kids", color = TvColors.Muted, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TvButton(if (queueCount > 0) "Queue · $queueCount" else "Queue", onClick = onQueue)
            onWatchParty?.let { TvButton("Watch together", onClick = it) }
        }
    }
}

/** The playback queue outside the player, opened from the profile menu. */
@Composable
private fun TvQueueDrawer(model: TvShellModel, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocusWhenReady() }
    PlatformBackHandler(onBack = onClose)
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .6f))) {
        Column(
            Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .width(400.dp)
                .background(Color(0xF509090B))
                .padding(horizontal = 16.dp, vertical = TvSpacing.Edge)
                .focusRequester(focus)
                .tvFocusTrap(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TvQueueList(
                items = model.sync.snapshot?.queue.orEmpty(),
                onPlay = { item ->
                    onClose()
                    model.onPlayQueued(item)
                },
                onChange = { items -> model.onMutation(media.conduit.mobile.account.ProfileMutation.SetQueue(items)) },
            )
        }
    }
}
