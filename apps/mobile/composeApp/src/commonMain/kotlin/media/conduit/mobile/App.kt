package media.conduit.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import media.conduit.mobile.foundation.*
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.account.SessionVault

@Composable
fun App() {
    ConduitTheme {
        val services = rememberPlatformServices()
        val store = remember(services.settings, services.secure) {
            AppStore(services.settings, SessionVault(services.secure))
        }
        var state by remember { mutableStateOf(store.state) }
        val dispatch: (AppAction) -> Unit = { state = store.dispatch(it) }

        if (state.endpoint == null) {
            ServerSetup(state, dispatch)
        } else {
            AppShell(state, services.info, dispatch)
        }
    }
}

@Composable
private fun ServerSetup(state: AppState, dispatch: (AppAction) -> Unit) {
    val api = remember { ConduitApi() }
    DisposableEffect(api) { onDispose(api::close) }
    LaunchedEffect(state.pendingEndpoint) {
        val endpoint = state.pendingEndpoint ?: return@LaunchedEffect
        runCatching { api.validate(endpoint.baseUrl) }
            .onSuccess { dispatch(AppAction.ConnectionSucceeded(endpoint)) }
            .onFailure { cause ->
                dispatch(
                    AppAction.ConnectionFailed(
                        cause.message ?: "Unable to connect to this Conduit server",
                    ),
                )
            }
    }
    Surface(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize().safeContentPadding()) {
            Column(
                Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Conduit", style = MaterialTheme.typography.displaySmall)
                Text("Connect to your server", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Use HTTPS for hosted or self-hosted instances. HTTP is limited to local development hosts.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = state.setupInput,
                    onValueChange = { dispatch(AppAction.SetupInputChanged(it)) },
                    label = { Text("Server URL") },
                    placeholder = { Text("https://conduit.example") },
                    supportingText = state.setupError?.let { message -> { Text(message) } },
                    isError = state.setupError != null,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { dispatch(AppAction.ConnectRequested) },
                    enabled = state.pendingEndpoint == null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (state.pendingEndpoint != null) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Checking server…")
                    } else {
                        Text("Continue")
                    }
                }
                Text(
                    "Conduit checks server health and authentication capabilities before saving it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun AppShell(
    state: AppState,
    platform: PlatformInfo,
    dispatch: (AppAction) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 720.dp
        val snackbarHostState = remember { SnackbarHostState() }
        LaunchedEffect(state.notice) {
            state.notice?.let {
                snackbarHostState.showSnackbar(it)
                dispatch(AppAction.DismissNotice)
            }
        }
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            bottomBar = {
                if (!expanded) {
                    NavigationBar {
                        AppDestination.entries.forEach { destination ->
                            NavigationBarItem(
                                selected = state.destination == destination,
                                onClick = { dispatch(AppAction.Navigate(destination)) },
                                icon = { Text(destination.label.take(1)) },
                                label = { Text(destination.label) },
                            )
                        }
                    }
                }
            },
        ) { padding ->
            if (expanded) {
                Row(Modifier.fillMaxSize().padding(padding)) {
                    NavigationRail {
                        Spacer(Modifier.height(16.dp))
                        AppDestination.entries.forEach { destination ->
                            NavigationRailItem(
                                selected = state.destination == destination,
                                onClick = { dispatch(AppAction.Navigate(destination)) },
                                icon = { Text(destination.label.take(1)) },
                                label = { Text(destination.label) },
                            )
                        }
                    }
                    DestinationContent(state, platform, dispatch, Modifier.weight(1f))
                }
            } else {
                DestinationContent(state, platform, dispatch, Modifier.padding(padding))
            }
        }
    }
}

@Composable
private fun DestinationContent(
    state: AppState,
    platform: PlatformInfo,
    dispatch: (AppAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().safeContentPadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(state.destination.label, style = MaterialTheme.typography.headlineMedium)
        when (state.destination) {
            AppDestination.Discover -> ArchitectureDemo()
            AppDestination.Library -> EmptyFoundationState(
                "Your library will live here",
                "Library synchronization belongs to a later roadmap milestone.",
            )
            AppDestination.Settings -> SettingsFoundation(state, platform, dispatch)
        }
    }
}

@Composable
private fun EmptyFoundationState(title: String, detail: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SettingsFoundation(state: AppState, platform: PlatformInfo, dispatch: (AppAction) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Server", style = MaterialTheme.typography.titleLarge)
            Text(state.endpoint?.label.orEmpty())
            Text(state.endpoint?.baseUrl.orEmpty(), style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = { dispatch(AppAction.ForgetEndpoint) }) { Text("Change server") }
        }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Device", style = MaterialTheme.typography.titleLarge)
            Text("${platform.name} ${platform.version}")
            Text(platform.device, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ArchitectureDemo() {
    val client = remember { EngineClient() }
    var engineState by remember { mutableStateOf<EngineState?>(null) }
    var playback by remember { mutableStateOf(PlaybackState()) }
    var playerOpen by remember { mutableStateOf(false) }
    var requestSequence by remember { mutableStateOf(0L) }
    var activeRequestId by remember { mutableStateOf<String?>(null) }
    val resolved = engineState as? EngineState.Resolved

    DisposableEffect(client) {
        onDispose {
            runCatching { client.dispatch(EngineAction.Close()) }
            client.close()
        }
    }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Architecture demo", style = MaterialTheme.typography.titleLarge)
            Text("Deterministic local add-on fixture")
            Button(onClick = {
                val requestId = "fixture-${++requestSequence}"
                activeRequestId = requestId
                engineState = client.dispatch(EngineAction.ResolveStreams(requestId = requestId))
                playerOpen = false
            }) { Text("Resolve catalog item") }
            when (val current = engineState) {
                is EngineState.Resolved -> {
                    Text("${current.addonName} · ${current.streamTitle}")
                    Text(current.requestUrl, style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { playerOpen = true }) { Text("Play legal test stream") }
                }
                is EngineState.Error -> Text("${current.code}: ${current.message}")
                is EngineState.Cancelled -> Text("Resolution cancelled")
                else -> Unit
            }
        }
    }
    if (playerOpen && resolved != null) {
        NativePlayer(
            url = resolved.streamUrl,
            active = true,
            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
            onState = { playback = it },
        )
        Text(
            "Native player · ${playback.positionMs / 1000}s / ${playback.durationMs / 1000}s" +
                if (playback.playing) " · playing" else " · paused",
        )
        playback.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        OutlinedButton(onClick = {
            playerOpen = false
            activeRequestId?.let { engineState = client.dispatch(EngineAction.Cancel(requestId = it)) }
        }) { Text("Close player") }
    }
}
