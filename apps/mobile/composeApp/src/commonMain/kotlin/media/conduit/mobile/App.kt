package media.conduit.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.AccountCircle
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import media.conduit.mobile.foundation.*
import media.conduit.mobile.account.ConduitApi
import media.conduit.mobile.account.SessionVault
import media.conduit.mobile.account.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

@Composable
fun App() {
    val services = rememberPlatformServices()
    val preferencesRepository = remember(services.settings) { DevicePreferencesRepository(services.settings) }
    var preferences by remember { mutableStateOf(preferencesRepository.load()) }
    val updatePreferences: (DevicePreferences) -> Unit = { preferences = preferencesRepository.save(it) }
    ConduitTheme(amoledBlack = preferences.amoledBlack) {
        val store = remember(services.settings, services.secure) {
            AppStore(services.settings, SessionVault(services.secure))
        }
        var state by remember { mutableStateOf(store.state) }
        val dispatch: (AppAction) -> Unit = { state = store.dispatch(it) }

        if (state.endpoint == null) {
            ServerSetup(state, dispatch)
        } else {
            AccountGate(state, services, preferences, updatePreferences, dispatch)
        }
    }
}

@Composable
private fun AccountGate(
    state: AppState,
    services: PlatformServices,
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    dispatch: (AppAction) -> Unit,
) {
    val endpoint = state.endpoint ?: return
    val api = remember(endpoint.baseUrl) { ConduitApi() }
    val repository = remember(api, services.secure) {
        AccountRepository(api, SessionVault(services.secure))
    }
    val oauthPlatform = rememberMobileOAuthPlatform()
    val accountScope = rememberCoroutineScope()
    var account by remember(endpoint.baseUrl) { mutableStateOf<AccountStatus>(AccountStatus.Loading) }
    DisposableEffect(api) { onDispose(api::close) }
    LaunchedEffect(repository) { account = repository.restore(endpoint) }
    LaunchedEffect(oauthPlatform.callbackUrl) {
        val callback = oauthPlatform.callbackUrl ?: return@LaunchedEffect
        account = AccountStatus.Loading
        account = repository.completeOAuth(endpoint, callback)
        oauthPlatform.consumeCallback()
    }

    when (val current = account) {
        AccountStatus.Loading -> CenteredStatus("Connecting to ${endpoint.label}…")
        is AccountStatus.SignedOut -> SignInScreen(
            endpoint = endpoint,
            authentication = current.authentication,
            initialError = current.error,
            onSignIn = { email, password ->
                account = AccountStatus.Loading
                accountScope.launch {
                    account = repository.signIn(endpoint, current.authentication, email, password)
                }
            },
            onRegister = { email, password ->
                account = AccountStatus.Loading
                accountScope.launch {
                    account = repository.register(endpoint, current.authentication, email, password)
                }
            },
            onRecover = { email, code, password ->
                account = AccountStatus.Loading
                accountScope.launch { account = repository.recover(endpoint, current.authentication, email, code, password) }
            },
            onOAuth = {
                accountScope.launch {
                    runCatching {
                        repository.startOAuth(endpoint, oauthPlatform.createPkce())
                    }.onSuccess { pending ->
                        oauthPlatform.openSystemBrowser(pending.authorizationUrl)
                    }.onFailure { cause ->
                        account = AccountStatus.SignedOut(
                            current.authentication,
                            cause.message ?: "Unable to start OAuth",
                        )
                    }
                }
            },
            serverError = state.setupError,
            serverPending = state.pendingEndpoint != null,
            onConnectServer = { rawUrl ->
                dispatch(AppAction.SetupInputChanged(rawUrl))
                dispatch(AppAction.ConnectRequested)
                val candidate = if (rawUrl.trimEnd('/') == DefaultServerEndpoint.baseUrl) DefaultServerEndpoint else (ServerEndpointValidator.validate(rawUrl) as? EndpointValidation.Valid)?.endpoint
                if (candidate != null) accountScope.launch {
                    runCatching { api.validate(candidate.baseUrl) }
                        .onSuccess { dispatch(AppAction.ConnectionSucceeded(candidate)) }
                        .onFailure { dispatch(AppAction.ConnectionFailed(it.message ?: "Unable to connect to this Conduit server")) }
                }
            },
        )
        is AccountStatus.SignedIn -> {
            if (current.bootstrap.households.isEmpty()) {
                HouseholdSetup(
                    onCreate = { household, profile ->
                        accountScope.launch {
                            account = repository.createHousehold(endpoint, current, household, profile)
                        }
                    },
                )
            } else {
                AppShell(
                    state = state,
                    platform = services.info,
                    account = current,
                    api = api,
                    secureStore = services.secure,
                    preferences = preferences,
                    onPreferencesChanged = onPreferencesChanged,
                    dispatch = dispatch,
                    onSignOut = {
                        accountScope.launch {
                            account = repository.signOut(endpoint, current.session)
                        }
                    },
                    onProfilesChanged = { selectedId ->
                        accountScope.launch {
                            account = repository.restore(endpoint)
                            selectedId?.let { dispatch(AppAction.SelectProfile(it)) }
                        }
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
                accountScope.launch { account = repository.restore(endpoint) }
            },
            onChangeServer = { dispatch(AppAction.ForgetEndpoint) },
        )
    }
}

@Composable
private fun RecoveryCodesScreen(codes: List<String>, onSaved: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.safeContentPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Save your recovery codes", style = MaterialTheme.typography.headlineMedium)
            Text("Each code works once. Store them outside this device before continuing.")
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    codes.forEach { code ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(code, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            IconButton(onClick = { clipboard.setText(AnnotatedString(code)) }) { Icon(Icons.Rounded.ContentCopy, "Copy code") }
                        }
                    }
                }
            }
            OutlinedButton(onClick = { clipboard.setText(AnnotatedString(codes.joinToString("\n"))) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.ContentCopy, null); Spacer(Modifier.width(8.dp)); Text("Copy all codes") }
            Button(onClick = onSaved, modifier = Modifier.fillMaxWidth()) {
                Text("I saved these codes")
            }
        }
    }
}

@Composable
private fun HouseholdSetup(onCreate: (String, String) -> Unit) {
    var household by remember { mutableStateOf("Home") }
    var profile by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
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
                    onCreate(household, profile)
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (pending) "Creating…" else "Create household") }
        }
    }
}

@Composable
private fun CenteredStatus(message: String) {
    val pulse = rememberInfiniteTransition(label = "conduit-launch")
    val scale by pulse.animateFloat(1f, 1.035f, infiniteRepeatable(tween(1_250, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "brand-scale")
    val alpha by pulse.animateFloat(.88f, 1f, infiniteRepeatable(tween(1_250, easing = LinearEasing), RepeatMode.Reverse), label = "brand-alpha")
    Box(Modifier.fillMaxSize().background(Brush.radialGradient(colors = listOf(Color(0xFF1B1608), Color(0xFF09090B), Color(0xFF050506)), radius = 720f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(22.dp), modifier = Modifier.padding(32.dp)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.scale(scale).alpha(alpha)) {
                Surface(color = MaterialTheme.colorScheme.primary, contentColor = Color.Black, shape = RoundedCornerShape(18.dp), shadowElevation = 10.dp, modifier = Modifier.size(66.dp)) {
                    Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Movie, null, modifier = Modifier.size(36.dp)) }
                }
                Text("conduit", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            }
            CircularProgressIndicator(color = Color(0xFFFBBF24), trackColor = Color.White.copy(.14f), strokeWidth = 3.dp, modifier = Modifier.size(30.dp))
            Text(message, color = Color(0xFFB8B8C2), style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        }
    }
}

@Composable
private fun SignInScreen(
    endpoint: ServerEndpoint,
    authentication: AuthenticationConfiguration,
    initialError: String?,
    onSignIn: (String, String) -> Unit,
    onRegister: (String, String) -> Unit,
    onRecover: (String, String, String) -> Unit,
    onOAuth: () -> Unit,
    serverError: String?,
    serverPending: Boolean,
    onConnectServer: (String) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember(initialError) { mutableStateOf(initialError) }
    var pending by remember(initialError) { mutableStateOf(false) }
    var registering by remember { mutableStateOf(authentication.needsOwner) }
    var recovering by remember { mutableStateOf(false) }
    var recoveryCode by remember { mutableStateOf("") }
    var showServerDialog by remember { mutableStateOf(false) }
    var useDefault by remember(endpoint.baseUrl) { mutableStateOf(endpoint == DefaultServerEndpoint) }
    var customServer by remember(endpoint.baseUrl) { mutableStateOf(if (endpoint == DefaultServerEndpoint) "" else endpoint.baseUrl) }
    Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(MaterialTheme.colorScheme.primary.copy(.09f), MaterialTheme.colorScheme.background), radius = 900f)), contentAlignment = Alignment.Center) {
        Column(Modifier.safeContentPadding().verticalScroll(rememberScrollState()).widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) { Surface(color = MaterialTheme.colorScheme.primary, contentColor = Color.Black, shape = RoundedCornerShape(12.dp), modifier = Modifier.size(40.dp)) { Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Movie, null, modifier = Modifier.size(22.dp)) } }; Text("conduit", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.weight(1f))
                Surface(onClick = { showServerDialog = true }, shape = RoundedCornerShape(20.dp), color = Color(0xE61D1D20), contentColor = Color.White, border = BorderStroke(1.dp, Color.White.copy(.13f))) {
                    Row(Modifier.padding(horizontal = 11.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(7.dp).background(Color(0xFF34D399), androidx.compose.foundation.shape.CircleShape))
                        Spacer(Modifier.width(7.dp))
                        Text(if (endpoint == DefaultServerEndpoint) "Default" else endpoint.label, color = Color.White.copy(.86f), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    }
                }
            }
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFA18181B), contentColor = Color.White), border = BorderStroke(1.dp, Color.White.copy(.11f)), shape = RoundedCornerShape(22.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(15.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(if (recovering) "Recover your account" else if (registering) if (authentication.needsOwner) "Set up Conduit" else "Create your account" else "Welcome back", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(if (recovering) "Enter one of the recovery codes you saved." else if (registering) "Create a private account for this Conduit instance." else "Sign in to continue to your household.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            authentication.oidc.takeIf { it.enabled && !recovering }?.let {
                Button(enabled = !pending, onClick = { pending = true; onOAuth() }, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF202124), disabledContainerColor = Color(0xFFE6E6E6), disabledContentColor = Color(0xFF5F6368)), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().height(50.dp)) { GoogleMark(); Spacer(Modifier.width(12.dp)); Text(it.displayName ?: "Continue with Google", fontWeight = FontWeight.SemiBold) }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { HorizontalDivider(Modifier.weight(1f), color = Color.White.copy(.1f)); Text("  OR CONTINUE WITH EMAIL  ", color = Color.White.copy(.3f), style = MaterialTheme.typography.labelSmall); HorizontalDivider(Modifier.weight(1f), color = Color.White.copy(.1f)) }
            }
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; error = null },
                label = { Text("Email address") }, placeholder = { Text("you@example.com") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (recovering) OutlinedTextField(value = recoveryCode, onValueChange = { recoveryCode = it; error = null }, label = { Text("Recovery code") }, placeholder = { Text("XXXX-XXXX-XXXX-XXXX") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; error = null },
                label = { Text(if (recovering) "New password" else "Password") }, placeholder = { Text(if (registering || recovering) "At least 8 characters" else "Enter your password") },
                singleLine = true,
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                enabled = !pending && email.isNotBlank() && password.length >= 8 && (!recovering || recoveryCode.isNotBlank()),
                onClick = {
                    pending = true
                    if (recovering) onRecover(email, recoveryCode, password) else if (registering) onRegister(email, password) else onSignIn(email, password)
                },
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = Color(0xFF141414), disabledContainerColor = Color.White.copy(.10f), disabledContentColor = Color.White.copy(.34f)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Text(
                    if (pending) "Please wait…" else if (recovering) "Reset password" else if (registering) "Create account" else "Sign in",
                )
            }
            if (password.isNotEmpty() && password.length < 8) {
                Text(
                    "Password must contain at least 8 characters.",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (!recovering && !registering) TextButton(onClick = { recovering = true; error = null; password = "" }) { Text("Use recovery code", color = Color.White.copy(.72f)) }
            if (recovering) TextButton(onClick = { recovering = false; error = null; password = "" }) { Text("Back to sign in", color = Color.White.copy(.72f)) }
            if (authentication.localRegistration && !recovering) {
                TextButton(onClick = { registering = !registering; error = null }) {
                    Text(if (registering) "Already have an account? Sign in" else "New to this instance? Create a local account", color = Color.White.copy(.82f))
                }
            }
                }
            }
        }
        if (showServerDialog) Dialog(onDismissRequest = { if (!serverPending) showServerDialog = false }) {
            Surface(Modifier.fillMaxWidth().widthIn(max = 440.dp), shape = RoundedCornerShape(24.dp), color = Color(0xFF18181B), contentColor = Color.White, border = BorderStroke(1.dp, Color.White.copy(.12f)), tonalElevation = 8.dp) {
              Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.Public, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp)); Column { Text("Choose your server", fontWeight = FontWeight.Bold); Text("Your choice stays on this device.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) } }
                ServerChoiceRow("Default server", DefaultServerEndpoint.baseUrl, useDefault) { useDefault = true }
                ServerChoiceRow("Self-hosted server", "Connect directly to your own instance", !useDefault) { useDefault = false }
                if (!useDefault) OutlinedTextField(value = customServer, onValueChange = { customServer = it }, label = { Text("Server address") }, placeholder = { Text("https://conduit.example.com") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                serverError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
                    TextButton(onClick = { showServerDialog = false }, enabled = !serverPending) { Text("Cancel", color = Color.White.copy(.7f)) }
                    Button(onClick = { onConnectServer(if (useDefault) DefaultServerEndpoint.baseUrl else customServer) }, enabled = !serverPending && (useDefault || customServer.isNotBlank())) { if (serverPending) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }; Text(if (serverPending) "Checking…" else "Connect") }
                }
              }
            }
          }
    }
}

@Composable
private fun GoogleMark() {
    Canvas(Modifier.size(19.dp)) {
        val stroke = size.minDimension * .19f
        val inset = stroke / 2f
        val arcSize = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke)
        val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
        val style = Stroke(stroke, cap = StrokeCap.Butt)
        drawArc(Color(0xFF4285F4), -42f, 96f, false, topLeft, arcSize, style = style)
        drawArc(Color(0xFF34A853), 54f, 86f, false, topLeft, arcSize, style = style)
        drawArc(Color(0xFFFBBC05), 140f, 70f, false, topLeft, arcSize, style = style)
        drawArc(Color(0xFFEA4335), 210f, 108f, false, topLeft, arcSize, style = style)
        drawLine(
            color = Color(0xFF4285F4),
            start = androidx.compose.ui.geometry.Offset(size.width * .53f, size.height * .51f),
            end = androidx.compose.ui.geometry.Offset(size.width * .92f, size.height * .51f),
            strokeWidth = stroke,
            cap = StrokeCap.Butt,
        )
        drawLine(
            color = Color(0xFF4285F4),
            start = androidx.compose.ui.geometry.Offset(size.width * .82f, size.height * .48f),
            end = androidx.compose.ui.geometry.Offset(size.width * .82f, size.height * .72f),
            strokeWidth = stroke,
            cap = StrokeCap.Butt,
        )
    }
}

@Composable
private fun ServerChoiceRow(title: String, detail: String, selected: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, color = if (selected) MaterialTheme.colorScheme.primary.copy(.12f) else Color.White.copy(.035f), contentColor = Color.White, border = BorderStroke(1.dp, if (selected) MaterialTheme.colorScheme.primary.copy(.6f) else Color.White.copy(.08f)), shape = RoundedCornerShape(14.dp)) { Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(title, color = Color.White, fontWeight = FontWeight.SemiBold); Text(detail, color = Color.White.copy(.55f), style = MaterialTheme.typography.bodySmall, maxLines = 1) }; if (selected) Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) } }
}

@Composable
private fun ConnectionError(message: String, onRetry: () -> Unit, onChangeServer: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Server unavailable", style = MaterialTheme.typography.headlineSmall)
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = onRetry) { Text("Retry") }
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
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    dispatch: (AppAction) -> Unit,
    onSignOut: () -> Unit,
    onProfilesChanged: (String?) -> Unit,
) {
    val profiles = account.bootstrap.households.flatMap { it.profiles }
    val activeProfile = profiles.firstOrNull { it.id == state.activeProfileId } ?: profiles.firstOrNull()
    val syncRepository = remember(api, secureStore) { ProfileSyncRepository(api, secureStore) }
    val mutationMutex = remember { Mutex() }
    val appScope = rememberCoroutineScope()
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
    var selectedMedia by remember { mutableStateOf<CatalogItem?>(null) }
    var profileFlowActive by remember { mutableStateOf(false) }
    var selectedVideoId by remember { mutableStateOf<String?>(null) }
    val homeListState = rememberLazyListState()
    val searchListState = rememberLazyListState()
    val libraryGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val historyGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val settingsListState = rememberLazyListState()
    var browseQuery by remember(activeProfile?.id) { mutableStateOf("") }
    var discoverSelection by remember(activeProfile?.id) { mutableStateOf(DiscoverSelection()) }
    var adaptiveCompact by remember { mutableStateOf(false) }
    LaunchedEffect(state.destination, homeListState, searchListState, libraryGridState, settingsListState) {
        fun position(): Long = when (state.destination) {
            AppDestination.Home -> (homeListState.firstVisibleItemIndex.toLong() shl 32) or homeListState.firstVisibleItemScrollOffset.toLong()
            AppDestination.Search -> (searchListState.firstVisibleItemIndex.toLong() shl 32) or searchListState.firstVisibleItemScrollOffset.toLong()
            AppDestination.Library -> (libraryGridState.firstVisibleItemIndex.toLong() shl 32) or libraryGridState.firstVisibleItemScrollOffset.toLong()
            AppDestination.Profile -> (settingsListState.firstVisibleItemIndex.toLong() shl 32) or settingsListState.firstVisibleItemScrollOffset.toLong()
            AppDestination.History -> (historyGridState.firstVisibleItemIndex.toLong() shl 32) or historyGridState.firstVisibleItemScrollOffset.toLong()
        }
        var previous = position()
        adaptiveCompact = previous != 0L
        snapshotFlow { position() }
            .collect { current ->
                if (current == 0L) adaptiveCompact = false
                else if (current > previous) adaptiveCompact = true
                else if (current < previous) adaptiveCompact = false
                previous = current
            }
    }
    val selectMedia: (CatalogItem, String?) -> Unit = { item, videoId ->
        selectedMedia = item
        selectedVideoId = videoId
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // A rotated phone can be wider than 720dp while still having very little
        // vertical room. Treat only genuinely large windows as the expanded
        // layout so rotation does not move the active screen to a new branch and
        // discard transient state such as the selected playback stream.
        val expanded = maxWidth >= 720.dp && maxHeight >= 600.dp
        val snackbarHostState = remember { SnackbarHostState() }
        suspend fun mutateProfile(mutation: ProfileMutation): Result<Unit> {
            val profile = activeProfile ?: return Result.failure(IllegalStateException("No active profile"))
            val result = mutationMutex.withLock {
                val before = profileSync.snapshot
                    ?: return@withLock Result.failure(IllegalStateException("Profile is not synchronized"))
                val optimistic = before.applyOptimistically(mutation)
                profileSync = profileSync.copy(snapshot = optimistic, offline = false, error = null)
                syncRepository.save(optimistic)
                runCatching {
                    api.executeMutation(state.endpoint!!.baseUrl, account.session.token, profile.id, mutation)
                    profileSync = syncRepository.synchronize(state.endpoint.baseUrl, account.session.token, profile.id)
                }.onFailure {
                    profileSync = profileSync.copy(snapshot = before, error = it.message)
                    syncRepository.save(before)
                }
            }
            result.exceptionOrNull()?.let { snackbarHostState.showSnackbar(it.message ?: "Unable to update this title") }
            if (result.isSuccess && mutation is ProfileMutation.SetLibrary && !mutation.saved) {
                if (snackbarHostState.showSnackbar("Removed from library", "Undo") == SnackbarResult.ActionPerformed) {
                    mutateProfile(mutation.copy(saved = true))
                }
            }
            return result
        }
        val openMedia: (CatalogItem, String?) -> Unit = { item, videoId ->
            selectMedia(item, videoId)
            if (!state.richActionsHintShown) {
                dispatch(AppAction.RichActionsHintShown)
                appScope.launch { snackbarHostState.showSnackbar("Touch and hold a title for more options") }
            }
        }
        val openBrowse: (MobileBrowseTarget) -> Unit = { target ->
            when (target) {
                is MobileBrowseTarget.Discover -> {
                    browseQuery = ""
                    discoverSelection = target.selection
                }
                is MobileBrowseTarget.Search -> browseQuery = target.query
            }
            selectedMedia = null
            dispatch(AppAction.Navigate(AppDestination.Search))
        }
        LaunchedEffect(state.notice) {
            state.notice?.let {
                snackbarHostState.showSnackbar(it)
                dispatch(AppAction.DismissNotice)
            }
        }
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
        ) { padding ->
            if (expanded) {
                Row(Modifier.fillMaxSize().padding(padding)) {
                    NavigationRail {
                        Spacer(Modifier.height(16.dp))
                        AppDestination.entries.filter(AppDestination::showInNavigation).forEach { destination ->
                            NavigationRailItem(
                                selected = state.destination == destination,
                                onClick = { dispatch(AppAction.Navigate(destination)) },
                                icon = { Icon(destination.icon, destination.label) },
                                label = { Text(destination.label) },
                            )
                        }
                    }
                    DestinationContent(
                        state, platform, account, activeProfile, profileSync, api, selectedMedia,
                        selectedVideoId, openMedia, { selectedMedia = null }, dispatch, onSignOut, onProfilesChanged,
                        { profileFlowActive = it },
                        { activeProfile?.let { profile -> appScope.launch { profileSync = syncRepository.synchronize(state.endpoint!!.baseUrl, account.session.token, profile.id) } } },
                        ::mutateProfile,
                        browseQuery, { browseQuery = it }, discoverSelection, { discoverSelection = it }, openBrowse,
                        preferences, onPreferencesChanged, homeListState, searchListState, libraryGridState, historyGridState, settingsListState,
                        Modifier.weight(1f),
                    )
                }
            } else {
                DestinationContent(
                    state, platform, account, activeProfile, profileSync, api, selectedMedia,
                    selectedVideoId, openMedia, { selectedMedia = null }, dispatch, onSignOut, onProfilesChanged,
                    { profileFlowActive = it },
                    { activeProfile?.let { profile -> appScope.launch { profileSync = syncRepository.synchronize(state.endpoint!!.baseUrl, account.session.token, profile.id) } } },
                    ::mutateProfile,
                    browseQuery, { browseQuery = it }, discoverSelection, { discoverSelection = it }, openBrowse,
                    preferences, onPreferencesChanged, homeListState, searchListState, libraryGridState, historyGridState, settingsListState,
                    Modifier.padding(padding),
                )
            }
        }
        if (!expanded && selectedMedia == null && !profileFlowActive) {
            val classic = preferences.navigationStyle == NavigationStyle.Classic
            val compact = preferences.navigationStyle == NavigationStyle.Compact ||
                (preferences.navigationStyle == NavigationStyle.Adaptive && adaptiveCompact)
            Surface(
                color = if (classic) MaterialTheme.colorScheme.surfaceContainer else Color(0xDD202023),
                shape = if (classic) RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp) else RoundedCornerShape(32.dp),
                border = if (classic) null else BorderStroke(1.dp, Color.White.copy(alpha = .12f)),
                shadowElevation = if (classic) 4.dp else 14.dp,
                modifier = Modifier.align(Alignment.BottomCenter)
                    .then(if (classic) Modifier else Modifier.navigationBarsPadding())
                    .then(if (classic) Modifier.fillMaxWidth() else if (compact) Modifier.padding(horizontal = 64.dp, vertical = 10.dp).fillMaxWidth() else Modifier.padding(horizontal = 14.dp, vertical = 10.dp).fillMaxWidth()),
            ) {
                Row(Modifier.fillMaxWidth().then(if (classic) Modifier.navigationBarsPadding() else Modifier).padding(horizontal = 8.dp, vertical = if (compact) 2.dp else 4.dp)) {
                    AppDestination.entries.filter(AppDestination::showInNavigation).forEach { destination ->
                        MobileNavigationItem(
                            destination = destination,
                            selected = state.destination == destination,
                            profile = activeProfile,
                            onClick = { dispatch(AppAction.Navigate(destination)) },
                            showLabel = !compact,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
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
    api: ConduitApi,
    selectedMedia: CatalogItem?,
    selectedVideoId: String?,
    onSelectMedia: (CatalogItem, String?) -> Unit,
    onCloseMedia: () -> Unit,
    dispatch: (AppAction) -> Unit,
    onSignOut: () -> Unit,
    onProfilesChanged: (String?) -> Unit,
    onProfileFlowChanged: (Boolean) -> Unit,
    onProfileDataChanged: () -> Unit,
    onProfileMutation: suspend (ProfileMutation) -> Result<Unit>,
    browseQuery: String,
    onBrowseQueryChange: (String) -> Unit,
    discoverSelection: DiscoverSelection,
    onDiscoverSelectionChange: (DiscoverSelection) -> Unit,
    onBrowse: (MobileBrowseTarget) -> Unit,
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    homeListState: androidx.compose.foundation.lazy.LazyListState,
    searchListState: androidx.compose.foundation.lazy.LazyListState,
    libraryGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    historyGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    settingsListState: androidx.compose.foundation.lazy.LazyListState,
    modifier: Modifier = Modifier,
) {
    val homeCache = remember(activeProfile?.id) { HomeScreenCache() }
    LaunchedEffect(state.destination) {
        if (state.destination != AppDestination.Profile) onProfileFlowChanged(false)
    }
    Box(modifier.fillMaxSize()) {
        AppDestination.entries.forEach { destination ->
            val active = selectedMedia == null && state.destination == destination
            val tabModifier = if (active) Modifier.fillMaxSize() else Modifier.size(0.dp)
            when (destination) {
                AppDestination.Home -> HomeScreen(
                    activeProfile, profileSync, api, onSelectMedia, onProfileMutation,
                    onOpenHistory = { dispatch(AppAction.Navigate(AppDestination.History)) },
                    onOpenLibrary = { dispatch(AppAction.Navigate(AppDestination.Library)) },
                    onOpenDiscover = { onBrowse(MobileBrowseTarget.Discover(it)) },
                    listState = homeListState, cache = homeCache, modifier = tabModifier,
                )
                AppDestination.Search -> SearchDiscoverScreen(
                    addons = profileSync.snapshot?.addons.orEmpty(), api = api,
                    snapshot = profileSync.snapshot, query = browseQuery, onQueryChange = onBrowseQueryChange,
                    selection = discoverSelection, onSelectionChange = onDiscoverSelectionChange,
                    onMutation = onProfileMutation,
                    onSelect = { onSelectMedia(it, null) }, listState = searchListState, modifier = tabModifier,
                )
                AppDestination.Library -> MobileLibraryScreen(
                    snapshot = profileSync.snapshot, api = api, onMutation = onProfileMutation,
                    onSelect = { onSelectMedia(it, null) }, onSelectVideo = onSelectMedia,
                    gridState = libraryGridState, modifier = tabModifier,
                )
                AppDestination.Profile -> ProfileSettingsScreen(
                    state, platform, account, activeProfile, profileSync, api, dispatch, onSignOut,
                    onProfilesChanged, { if (active) onProfileFlowChanged(it) }, onProfileDataChanged,
                    onProfileMutation, onSelectMedia,
                    preferences, onPreferencesChanged, settingsListState = settingsListState, modifier = tabModifier,
                )
                AppDestination.History -> MobileHistoryScreen(
                    snapshot = profileSync.snapshot, api = api, onMutation = onProfileMutation,
                    onSelect = { onSelectMedia(it, null) }, onSelectVideo = onSelectMedia,
                    gridState = historyGridState, modifier = tabModifier,
                )
            }
        }
        if (selectedMedia != null) {
            MediaDetailsScreen(
                item = selectedMedia,
                initialVideoId = selectedVideoId,
                addons = profileSync.snapshot?.addons.orEmpty(),
                api = api,
                profile = activeProfile,
                snapshot = profileSync.snapshot,
                baseUrl = state.endpoint!!.baseUrl,
                token = account.session.token,
                preferences = preferences,
                onProgressChanged = onProfileDataChanged,
                onMutation = onProfileMutation,
                onBrowse = onBrowse,
                onBack = onCloseMedia,
            )
        }
        if (profileSync.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
    }
}

private val AppDestination.icon: ImageVector
    get() = when (this) {
        AppDestination.Home -> Icons.Rounded.Home
        AppDestination.Search -> Icons.Rounded.Search
        AppDestination.Library -> Icons.Rounded.VideoLibrary
        AppDestination.Profile -> Icons.Rounded.AccountCircle
        AppDestination.History -> Icons.Rounded.History
    }

@Composable
private fun RowScope.MobileNavigationItem(
    destination: AppDestination,
    selected: Boolean,
    profile: ProfileSummary?,
    onClick: () -> Unit,
    showLabel: Boolean,
    modifier: Modifier = Modifier,
) {
    val color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        modifier.clip(RoundedCornerShape(24.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .12f) else Color.Transparent)
            .clickable(onClick = onClick).padding(top = if (showLabel) 8.dp else 10.dp, bottom = if (showLabel) 7.dp else 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (destination == AppDestination.Profile) {
            Surface(
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                shape = MaterialTheme.shapes.extraLarge,
                modifier = Modifier.size(25.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(profile?.name?.take(1)?.uppercase() ?: "P", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                }
            }
        } else {
            Icon(destination.icon, destination.label, tint = color, modifier = Modifier.size(24.dp))
        }
        if (showLabel) Text(destination.label, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun SearchFoundation(modifier: Modifier = Modifier) {
    var query by remember { mutableStateOf("") }
    Column(modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("Search", style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Movies, series, and episodes") },
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            singleLine = true,
            shape = MaterialTheme.shapes.extraLarge,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            if (query.isBlank()) "Search across every compatible installed add-on."
            else "Catalog search is the next part of this mobile slice.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
    onSignOut: () -> Unit,
) {
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
            OutlinedButton(onClick = onSignOut) { Text("Sign out") }
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
