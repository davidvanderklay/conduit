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
import media.conduit.mobile.account.*
import kotlinx.coroutines.launch

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
            AccountGate(state, services, dispatch)
        }
    }
}

@Composable
private fun AccountGate(
    state: AppState,
    services: PlatformServices,
    dispatch: (AppAction) -> Unit,
) {
    val endpoint = state.endpoint ?: return
    val api = remember(endpoint.baseUrl) { ConduitApi() }
    val repository = remember(api, services.secure) {
        AccountRepository(api, SessionVault(services.secure))
    }
    var account by remember(endpoint.baseUrl) { mutableStateOf<AccountStatus>(AccountStatus.Loading) }
    DisposableEffect(api) { onDispose(api::close) }
    LaunchedEffect(repository) { account = repository.restore(endpoint) }

    when (val current = account) {
        AccountStatus.Loading -> CenteredStatus("Connecting to ${endpoint.label}…")
        is AccountStatus.SignedOut -> SignInScreen(
            endpoint = endpoint,
            authentication = current.authentication,
            initialError = current.error,
            onSignIn = { email, password ->
                account = AccountStatus.Loading
                account = repository.signIn(endpoint, current.authentication, email, password)
            },
            onRegister = { email, password ->
                account = AccountStatus.Loading
                account = repository.register(endpoint, current.authentication, email, password)
            },
            onChangeServer = { dispatch(AppAction.ForgetEndpoint) },
        )
        is AccountStatus.SignedIn -> {
            if (current.bootstrap.households.isEmpty()) {
                HouseholdSetup(
                    onCreate = { household, profile ->
                        account = AccountStatus.Loading
                        account = repository.createHousehold(endpoint, current, household, profile)
                    },
                )
            } else {
                AppShell(
                    state = state,
                    platform = services.info,
                    account = current,
                    api = api,
                    secureStore = services.secure,
                    dispatch = dispatch,
                    onSignOut = {
                        account = AccountStatus.Loading
                        account = repository.signOut(endpoint, current.session)
                    },
                )
            }
        }
        is AccountStatus.RecoveryCodes -> RecoveryCodesScreen(
            codes = current.codes,
            onSaved = { account = current.signedIn },
        )
        is AccountStatus.Error -> ConnectionError(
            message = current.message,
            onRetry = {
                account = AccountStatus.Loading
                account = repository.restore(endpoint)
            },
            onChangeServer = { dispatch(AppAction.ForgetEndpoint) },
        )
    }
}

@Composable
private fun RecoveryCodesScreen(codes: List<String>, onSaved: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.safeContentPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Save your recovery codes", style = MaterialTheme.typography.headlineMedium)
            Text("Each code works once. Store them outside this device before continuing.")
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    codes.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
                }
            }
            Button(onClick = onSaved, modifier = Modifier.fillMaxWidth()) {
                Text("I saved these codes")
            }
        }
    }
}

@Composable
private fun HouseholdSetup(onCreate: suspend (String, String) -> Unit) {
    var household by remember { mutableStateOf("Home") }
    var profile by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.safeContentPadding().widthIn(max = 560.dp).fillMaxWidth().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Create your household", style = MaterialTheme.typography.headlineMedium)
            Text("Profiles, add-ons, and watch state synchronize through your Conduit server.")
            OutlinedTextField(
                household, { household = it }, label = { Text("Household name") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                profile, { profile = it }, label = { Text("Your profile name") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = !pending && household.isNotBlank() && profile.isNotBlank(),
                onClick = {
                    pending = true
                    scope.launch { onCreate(household, profile); pending = false }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (pending) "Creating…" else "Create household") }
        }
    }
}

@Composable
private fun CenteredStatus(message: String) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            CircularProgressIndicator()
            Spacer(Modifier.height(16.dp))
            Text(message)
        }
    }
}

@Composable
private fun SignInScreen(
    endpoint: ServerEndpoint,
    authentication: AuthenticationConfiguration,
    initialError: String?,
    onSignIn: suspend (String, String) -> Unit,
    onRegister: suspend (String, String) -> Unit,
    onChangeServer: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember(initialError) { mutableStateOf(initialError) }
    var pending by remember { mutableStateOf(false) }
    var registering by remember { mutableStateOf(authentication.needsOwner) }
    val scope = rememberCoroutineScope()
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.safeContentPadding().widthIn(max = 560.dp).fillMaxWidth().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                if (registering) "Create your Conduit account" else "Sign in to Conduit",
                style = MaterialTheme.typography.headlineMedium,
            )
            Text(endpoint.baseUrl, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; error = null },
                label = { Text("Email") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; error = null },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                enabled = !pending && email.isNotBlank() && password.isNotBlank(),
                onClick = {
                    pending = true
                    scope.launch {
                        runCatching {
                            if (registering) onRegister(email, password) else onSignIn(email, password)
                        }
                            .onFailure { error = it.message ?: "Unable to sign in" }
                        pending = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    if (pending) "Please wait…" else if (registering) "Create account" else "Sign in",
                )
            }
            if (authentication.localRegistration) {
                Text(
                    if (authentication.needsOwner) "This server still needs its owner account."
                    else "This server allows new local accounts.",
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = { registering = !registering; error = null }) {
                    Text(if (registering) "I already have an account" else "Create a local account")
                }
            }
            authentication.oidc.takeIf { it.enabled }?.let {
                Text("${it.displayName ?: "Browser sign-in"} will be added with the mobile deep-link handoff.")
            }
            TextButton(onClick = onChangeServer) { Text("Use another server") }
        }
    }
}

@Composable
private fun ConnectionError(message: String, onRetry: suspend () -> Unit, onChangeServer: () -> Unit) {
    val scope = rememberCoroutineScope()
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Server unavailable", style = MaterialTheme.typography.headlineSmall)
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = { scope.launch { onRetry() } }) { Text("Retry") }
            TextButton(onClick = onChangeServer) { Text("Use another server") }
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
    account: AccountStatus.SignedIn,
    api: ConduitApi,
    secureStore: SecureStore,
    dispatch: (AppAction) -> Unit,
    onSignOut: suspend () -> Unit,
) {
    val profiles = account.bootstrap.households.flatMap { it.profiles }
    val activeProfile = profiles.firstOrNull { it.id == state.activeProfileId } ?: profiles.firstOrNull()
    val syncRepository = remember(api, secureStore) { ProfileSyncRepository(api, secureStore) }
    var profileSync by remember(activeProfile?.id) {
        mutableStateOf(
            ProfileSyncState(snapshot = activeProfile?.let { syncRepository.cached(it.id) }),
        )
    }
    LaunchedEffect(activeProfile?.id, account.session.token) {
        val profile = activeProfile ?: return@LaunchedEffect
        profileSync = profileSync.copy(refreshing = true)
        profileSync = syncRepository.synchronize(
            state.endpoint!!.baseUrl,
            account.session.token,
            profile.id,
        )
    }
    LaunchedEffect(activeProfile?.id, state.activeProfileId) {
        if (activeProfile != null && activeProfile.id != state.activeProfileId) {
            dispatch(AppAction.SelectProfile(activeProfile.id))
        }
    }
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
                    DestinationContent(
                        state, platform, account, activeProfile, profileSync, dispatch, onSignOut,
                        Modifier.weight(1f),
                    )
                }
            } else {
                DestinationContent(
                    state, platform, account, activeProfile, profileSync, dispatch, onSignOut,
                    Modifier.padding(padding),
                )
            }
        }
    }
}

@Composable
private fun DestinationContent(
    state: AppState,
    platform: PlatformInfo,
    account: AccountStatus.SignedIn,
    activeProfile: ProfileSummary?,
    profileSync: ProfileSyncState,
    dispatch: (AppAction) -> Unit,
    onSignOut: suspend () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().safeContentPadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(state.destination.label, style = MaterialTheme.typography.headlineMedium)
        if (profileSync.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (profileSync.offline) {
            Text("Offline · showing encrypted cached data", color = MaterialTheme.colorScheme.tertiary)
        }
        profileSync.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        when (state.destination) {
            AppDestination.Discover -> {
                activeProfile?.let { Text("Watching as ${it.name}") }
                ArchitectureDemo()
            }
            AppDestination.Library -> LibrarySummary(profileSync.snapshot)
            AppDestination.Settings -> SettingsFoundation(
                state, platform, account, activeProfile, profileSync, dispatch, onSignOut,
            )
        }
    }
}

@Composable
private fun LibrarySummary(snapshot: ProfileSnapshot?) {
    val library = snapshot?.library.orEmpty()
    val progress = snapshot?.progress.orEmpty()
    if (snapshot == null) {
        EmptyFoundationState("Synchronizing your library", "Connect to load this profile's media state.")
        return
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${library.size} library items", style = MaterialTheme.typography.titleLarge)
            library.take(10).forEach { Text(it.name) }
            if (library.isEmpty()) Text("Your synchronized library is empty.")
        }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${progress.size} history entries", style = MaterialTheme.typography.titleLarge)
            progress.take(10).forEach { Text(it.name) }
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
private fun SettingsFoundation(
    state: AppState,
    platform: PlatformInfo,
    account: AccountStatus.SignedIn,
    activeProfile: ProfileSummary?,
    profileSync: ProfileSyncState,
    dispatch: (AppAction) -> Unit,
    onSignOut: suspend () -> Unit,
) {
    val scope = rememberCoroutineScope()
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Profiles", style = MaterialTheme.typography.titleLarge)
            account.bootstrap.households.forEach { household ->
                Text(household.name, style = MaterialTheme.typography.titleMedium)
                household.profiles.forEach { profile ->
                    FilterChip(
                        selected = profile.id == activeProfile?.id,
                        onClick = { dispatch(AppAction.SelectProfile(profile.id)) },
                        label = { Text(profile.name) },
                    )
                }
            }
            OutlinedButton(onClick = { scope.launch { onSignOut() } }) { Text("Sign out") }
            Text("${profileSync.snapshot?.addons?.size ?: 0} synchronized add-ons")
        }
    }
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
