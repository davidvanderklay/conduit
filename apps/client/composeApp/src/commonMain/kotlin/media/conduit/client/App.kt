package media.conduit.client

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.BookmarkRemove
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PictureInPictureAlt
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material.icons.rounded.FastForward
import androidx.compose.runtime.*
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateIntOffsetAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import media.conduit.client.foundation.*
import media.conduit.client.account.ConduitApi
import media.conduit.client.account.SessionVault
import media.conduit.client.account.*
import media.conduit.client.progressdb.ProgressDatabase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlin.time.Clock
import coil3.compose.AsyncImage

@Composable
fun App() {
    val services = rememberPlatformServices()
    val preferencesRepository = remember(services.settings) { DevicePreferencesRepository(services.settings) }
    val initialPreferences = remember(preferencesRepository, services.info.name) {
        val loaded = preferencesRepository.load()
        val normalized = loaded.normalizedForPlatform(services.info.name)
        if (normalized != loaded) preferencesRepository.save(normalized)
        normalized
    }
    var preferences by remember { mutableStateOf(initialPreferences) }
    val updatePreferences: (DevicePreferences) -> Unit = { preferences = preferencesRepository.save(it) }
    ConduitTheme(amoledBlack = preferences.amoledBlack) {
        val store = remember(services.settings, services.secure) {
            AppStore(services.settings, SessionVault(services.secure))
        }
        var state by remember { mutableStateOf(store.state) }
        val dispatch: (AppAction) -> Unit = { state = store.dispatch(it) }

        // iPadOS can report zero status-bar insets to the embedded Compose
        // controller. Apply the host-published inset once at the app root so
        // setup and authentication screens receive the same safe-area rule as
        // the signed-in shell.
        val density = LocalDensity.current
        val bridgedTopPx = with(density) { PlatformSafeArea.topInset.toPx() }
        val systemTopPx = WindowInsets.statusBars.getTop(density)
        val missingTopInset = with(density) { (bridgedTopPx - systemTopPx).coerceAtLeast(0f).toDp() }
        Box(Modifier.fillMaxSize().padding(top = missingTopInset)) {
            if (state.endpoint == null) {
                ServerSetup(state, dispatch)
            } else {
                AccountGate(state, services, preferences, updatePreferences, dispatch)
            }
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
    val progressDatabase = rememberProgressDatabase()
    val endpoint = state.endpoint ?: return
    val api = remember(endpoint.baseUrl) { ConduitApi() }
    val sessionVault = remember(services.secure) { SessionVault(services.secure) }
    val repository = remember(api, sessionVault) { AccountRepository(api, sessionVault) }
    val authenticationCache = remember(services.settings) { AuthenticationConfigurationCache(services.settings) }
    val cachedAuthentication = remember(endpoint.baseUrl) { authenticationCache.load(endpoint.baseUrl) }
    val hasStoredSession = remember(endpoint.baseUrl) { repository.hasStoredSession(endpoint.baseUrl) }
    val discoveryPlaceholder = remember {
        AuthenticationConfiguration(
            needsOwner = false,
            localRegistration = false,
            oidc = OidcConfiguration(enabled = false),
        )
    }
    val oauthPlatform = rememberMobileOAuthPlatform()
    val accountScope = rememberCoroutineScope()
    val lifecycleMutex = remember(repository) { Mutex() }
    var account by remember(endpoint.baseUrl) {
        mutableStateOf<AccountStatus>(
            if (hasStoredSession) AccountStatus.Loading
            else AccountStatus.SignedOut(cachedAuthentication ?: discoveryPlaceholder),
        )
    }
    var restoreStarted by remember(endpoint.baseUrl) { mutableStateOf(false) }
    var authenticationLoading by remember(endpoint.baseUrl) { mutableStateOf(!hasStoredSession) }
    var authenticationReady by remember(endpoint.baseUrl) { mutableStateOf(cachedAuthentication != null) }
    var authenticationError by remember(endpoint.baseUrl) { mutableStateOf<String?>(null) }
    var handledCallback by remember(endpoint.baseUrl) { mutableStateOf<String?>(null) }
    var oauthPending by remember(endpoint.baseUrl) { mutableStateOf(repository.hasPendingOAuth(endpoint.baseUrl)) }
    var oauthLaunching by remember(endpoint.baseUrl) { mutableStateOf(false) }
    DisposableEffect(api) { onDispose(api::close) }
    LaunchedEffect(repository) {
        if (restoreStarted) return@LaunchedEffect
        restoreStarted = true
        lifecycleMutex.withLock {
            if (hasStoredSession) {
                account = repository.restore(endpoint)
                (account as? AccountStatus.SignedOut)?.authentication?.let { configuration ->
                    authenticationCache.save(endpoint.baseUrl, configuration)
                    authenticationReady = true
                }
            } else {
                runCatching { repository.discoverAuthentication(endpoint) }
                    .onSuccess { configuration ->
                        authenticationCache.save(endpoint.baseUrl, configuration)
                        account = AccountStatus.SignedOut(configuration)
                        authenticationReady = true
                    }
                    .onFailure { cause ->
                        authenticationError = cause.message ?: "Unable to reach this server"
                    }
                authenticationLoading = false
            }
            oauthPending = repository.hasPendingOAuth(endpoint.baseUrl)
        }
    }
    LaunchedEffect(oauthPlatform.callbackUrl) {
        val callback = oauthPlatform.callbackUrl ?: return@LaunchedEffect
        if (callback == handledCallback) {
            oauthPlatform.consumeCallback()
            return@LaunchedEffect
        }
        lifecycleMutex.withLock {
            if (callback == handledCallback) {
                oauthPlatform.consumeCallback()
                return@withLock
            }
            if (!repository.hasPendingOAuth(endpoint.baseUrl)) {
                handledCallback = callback
                oauthPlatform.consumeCallback()
                LifecycleDiagnostics.event("oauth.callback.ignored", "reason=no-pending-request")
                return@withLock
            }
            oauthLaunching = false
            account = AccountStatus.Loading
            account = repository.completeOAuth(endpoint, callback)
            handledCallback = callback
            oauthPending = repository.hasPendingOAuth(endpoint.baseUrl)
            oauthPlatform.consumeCallback()
        }
    }

    when (val current = account) {
        AccountStatus.Loading -> ConduitLoadingScreen("CONNECTING TO SERVER")
        is AccountStatus.SignedOut -> SignInScreen(
            endpoint = endpoint,
            authentication = current.authentication,
            initialError = current.error,
            oauthPending = oauthPending,
            oauthLaunching = oauthLaunching,
            authenticationLoading = authenticationLoading,
            authenticationReady = authenticationReady,
            authenticationError = authenticationError,
            onRetryAuthentication = {
                if (!authenticationLoading) {
                    authenticationLoading = true
                    authenticationError = null
                    accountScope.launch {
                        lifecycleMutex.withLock {
                            runCatching { repository.discoverAuthentication(endpoint) }
                                .onSuccess { configuration ->
                                    authenticationCache.save(endpoint.baseUrl, configuration)
                                    account = AccountStatus.SignedOut(configuration)
                                    authenticationReady = true
                                }
                                .onFailure { cause ->
                                    authenticationError = cause.message ?: "Unable to reach this server"
                                }
                            authenticationLoading = false
                        }
                    }
                }
            },
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
                if (!oauthLaunching) {
                    oauthLaunching = true
                    accountScope.launch {
                        lifecycleMutex.withLock {
                            runCatching {
                                repository.pendingOAuth(endpoint.baseUrl)
                                    ?: repository.startOAuth(endpoint, oauthPlatform.createPkce())
                            }.onSuccess { pending ->
                                oauthPlatform.openSystemBrowser(pending.authorizationUrl)
                            }.onFailure { cause ->
                                account = AccountStatus.SignedOut(
                                    current.authentication,
                                    cause.message ?: "Unable to start OAuth",
                                )
                            }
                        }
                        oauthPending = repository.hasPendingOAuth(endpoint.baseUrl)
                        oauthLaunching = false
                    }
                }
            },
            serverNotice = state.notice,
            onDismissServerNotice = { dispatch(AppAction.DismissNotice) },
            serverError = state.setupError,
            serverPending = state.pendingEndpoint != null,
            onConnectServer = { rawUrl ->
                dispatch(AppAction.SetupInputChanged(rawUrl))
                dispatch(AppAction.ConnectRequested)
                val candidate = if (rawUrl.trimEnd('/') == DefaultServerEndpoint.baseUrl) DefaultServerEndpoint else (ServerEndpointValidator.validate(rawUrl) as? EndpointValidation.Valid)?.endpoint
                if (candidate != null) accountScope.launch {
                    runCatching { api.validate(candidate.baseUrl) }
                        .onSuccess { dispatch(AppAction.ConnectionSucceeded(candidate)) }
                        .onFailure { dispatch(AppAction.ConnectionFailed(it.message ?: "Unable to connect to this conduit server")) }
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
                    progressDatabase = progressDatabase,
                    preferences = preferences,
                    onPreferencesChanged = onPreferencesChanged,
                    dispatch = dispatch,
                    onSignOut = {
                        accountScope.launch {
                            account = repository.signOut(endpoint, current.session)
                            (account as? AccountStatus.SignedOut)?.authentication?.let { configuration ->
                                authenticationCache.save(endpoint.baseUrl, configuration)
                                authenticationReady = true
                            }
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
                accountScope.launch {
                    lifecycleMutex.withLock {
                        account = repository.restore(endpoint)
                        (account as? AccountStatus.SignedOut)?.authentication?.let { configuration ->
                            authenticationCache.save(endpoint.baseUrl, configuration)
                            authenticationReady = true
                        }
                        oauthPending = repository.hasPendingOAuth(endpoint.baseUrl)
                    }
                }
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
            Text("Profiles, add-ons, and watch state synchronize through your conduit server.")
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
private fun ConduitLoadingScreen(
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier.fillMaxSize().background(
            Brush.radialGradient(
                colors = listOf(Color(0xFF1A1405), Color(0xFF080806), Color.Black),
                radius = 720f,
            ),
        ),
    ) {
        Column(
            modifier = Modifier.align(Alignment.Center).offset(y = (-48).dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ConduitMark(Modifier.size(76.dp))
                Text(
                    "conduit",
                    color = Color.White,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            ConduitLoadingIndicator()
        }
        Text(
            label,
            color = Color(0xFF52525B),
            style = MaterialTheme.typography.labelSmall,
            letterSpacing = 1.2.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 36.dp),
        )
    }
}

@Composable
private fun ConduitLoadingIndicator(modifier: Modifier = Modifier) {
    CircularProgressIndicator(
        modifier = modifier.size(29.dp),
        color = Color(0xFFFBBF24),
        trackColor = Color.White.copy(alpha = .12f),
        strokeWidth = 3.dp,
        strokeCap = StrokeCap.Round,
    )
}

@Composable
private fun SignInScreen(
    endpoint: ServerEndpoint,
    authentication: AuthenticationConfiguration,
    initialError: String?,
    oauthPending: Boolean,
    oauthLaunching: Boolean,
    authenticationLoading: Boolean,
    authenticationReady: Boolean,
    authenticationError: String?,
    onRetryAuthentication: () -> Unit,
    onSignIn: (String, String) -> Unit,
    onRegister: (String, String) -> Unit,
    onRecover: (String, String, String) -> Unit,
    onOAuth: () -> Unit,
    serverNotice: String?,
    onDismissServerNotice: () -> Unit,
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
    val serverSnackbar = remember { SnackbarHostState() }
    var useDefault by remember(endpoint.baseUrl) { mutableStateOf(endpoint == DefaultServerEndpoint) }
    var customServer by remember(endpoint.baseUrl) { mutableStateOf(if (endpoint == DefaultServerEndpoint) "" else endpoint.baseUrl) }
    LaunchedEffect(authentication.needsOwner) {
        if (authentication.needsOwner) registering = true
    }
    LaunchedEffect(endpoint.baseUrl) {
        showServerDialog = false
    }
    LaunchedEffect(serverNotice) {
        val notice = serverNotice ?: return@LaunchedEffect
        showServerDialog = false
        serverSnackbar.showSnackbar(notice)
        onDismissServerNotice()
    }
    Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(MaterialTheme.colorScheme.primary.copy(.09f), MaterialTheme.colorScheme.background), radius = 900f)), contentAlignment = Alignment.Center) {
        Column(Modifier.safeContentPadding().imePadding().verticalScroll(rememberScrollState()).widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) { ConduitMark(Modifier.size(40.dp)); Text("conduit", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.weight(1f))
                Surface(onClick = { showServerDialog = true }, shape = RoundedCornerShape(20.dp), color = Color(0xE61D1D20), contentColor = Color.White, border = BorderStroke(1.dp, Color.White.copy(.13f))) {
                    Row(Modifier.padding(horizontal = 11.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        val serverColor = when {
                            authenticationError != null -> MaterialTheme.colorScheme.error
                            authenticationLoading -> Color(0xFFFBBF24)
                            else -> Color(0xFF34D399)
                        }
                        Box(Modifier.size(7.dp).background(serverColor, androidx.compose.foundation.shape.CircleShape))
                        Spacer(Modifier.width(7.dp))
                        Text(if (endpoint == DefaultServerEndpoint) "Default" else endpoint.label, color = Color.White.copy(.86f), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    }
                }
            }
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFA18181B), contentColor = Color.White), border = BorderStroke(1.dp, Color.White.copy(.11f)), shape = RoundedCornerShape(22.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(15.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(if (recovering) "Recover your account" else if (registering) if (authentication.needsOwner) "Set up conduit" else "Create your account" else "Welcome back", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(if (recovering) "Enter one of the recovery codes you saved." else if (registering) "Create a private account for this conduit instance." else "Sign in to continue to your household.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            if (authenticationLoading && !authenticationReady) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp)
                    Text("Waking server…", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
            authenticationError?.let { message ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onRetryAuthentication) { Text("Retry") }
                }
            }
            authentication.oidc.takeIf { it.enabled && !recovering }?.let {
                Button(enabled = authenticationReady && !pending && !oauthLaunching, onClick = onOAuth, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF202124), disabledContainerColor = Color(0xFFE6E6E6), disabledContentColor = Color(0xFF5F6368)), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().height(50.dp)) { GoogleMark(); Spacer(Modifier.width(12.dp)); Text(if (oauthLaunching) "Opening sign-in…" else if (oauthPending) "Resume sign-in" else it.displayName ?: "Continue with Google", fontWeight = FontWeight.SemiBold) }
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
                enabled = authenticationReady && !pending && email.isNotBlank() && password.length >= 8 && (!recovering || recoveryCode.isNotBlank()),
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
            if (authenticationReady && !recovering && !registering) TextButton(onClick = { recovering = true; error = null; password = "" }) { Text("Use recovery code", color = Color.White.copy(.72f)) }
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
        SnackbarHost(
            hostState = serverSnackbar,
            modifier = Modifier.align(Alignment.BottomCenter).safeContentPadding().padding(12.dp),
        ) { data -> ConduitSnackbar(data) }
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
                        cause.message ?: "Unable to connect to this conduit server",
                    ),
                )
            }
    }
    Surface(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize().safeContentPadding().imePadding()) {
            Column(
                Modifier.widthIn(max = 560.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("conduit", style = MaterialTheme.typography.displaySmall)
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
                    "conduit checks server health and authentication capabilities before saving it.",
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
    progressDatabase: ProgressDatabase?,
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    dispatch: (AppAction) -> Unit,
    onSignOut: () -> Unit,
    onProfilesChanged: (String?) -> Unit,
) {
    val profiles = account.bootstrap.households.flatMap { it.profiles }
    val activeProfile = profiles.firstOrNull { it.id == state.activeProfileId } ?: profiles.firstOrNull()
    val endpoint = checkNotNull(state.endpoint)
    val accountId = account.bootstrap.user?.email ?: account.session.token
    val profileCacheScope = "${endpoint.baseUrl.length}:${endpoint.baseUrl}${accountId.length}:$accountId"
    val syncRepository = remember(api, secureStore, profileCacheScope) { ProfileSyncRepository(api, secureStore, profileCacheScope) }
    val incrementalProgress = remember(api, progressDatabase) {
        progressDatabase?.let { IncrementalProgressRepository(api, it) }
    }
    val progressOutbox = remember(api, secureStore, incrementalProgress) { PlaybackProgressOutbox(api, secureStore, incrementalProgress) }
    val mutationMutex = remember { Mutex() }
    val profileSyncMutex = remember { Mutex() }
    val appScope = rememberCoroutineScope()
    val playbackSession = remember(appScope) { PlaybackSessionController(appScope) }
    LaunchedEffect(activeProfile?.id) {
        val playbackProfileId = playbackSession.state.request?.identity?.profileId
        if (playbackProfileId != null && playbackProfileId != activeProfile?.id) playbackSession.close()
    }
    var profileSync by remember(activeProfile?.id, account.session.token) {
        mutableStateOf(
            ProfileSyncState(
                snapshot = activeProfile?.let { syncRepository.cached(it.id) },
                refreshing = activeProfile != null,
            ),
        )
    }
    var queueManagerOpen by remember(activeProfile?.id) { mutableStateOf(false) }
    suspend fun synchronizeProfileData(profileId: String, fullResync: Boolean = false): ProfileSyncState {
        progressOutbox.flush(endpoint.baseUrl, account.session.token, accountId)
        val progress = incrementalProgress?.let { repository ->
            if (fullResync) {
                repository.fullResync(endpoint.baseUrl, account.session.token, accountId, profileId)
            } else {
                repository.synchronize(endpoint.baseUrl, account.session.token, accountId, profileId)
            }
        }
        val result = syncRepository.synchronize(
            endpoint.baseUrl,
            account.session.token,
            profileId,
            progressOverride = progress,
        )
        return result
    }
    suspend fun synchronizeProfileDataSafely(profileId: String, fullResync: Boolean = false): ProfileSyncState {
        return try {
            synchronizeProfileData(profileId, fullResync)
        } catch (cause: Throwable) {
            if (cause is CancellationException) throw cause
            LifecycleDiagnostics.event(
                "profile.sync.failed",
                "type=${cause::class.simpleName ?: "unknown"}",
            )
            profileSyncFailureState(
                snapshot = runCatching { syncRepository.cached(profileId) }.getOrNull() ?: profileSync.snapshot,
                cause = cause,
            )
        }
    }
    LaunchedEffect(activeProfile?.id, account.session.token) {
        val profile = activeProfile ?: return@LaunchedEffect
        profileSync = profileSync.copy(refreshing = true)
        profileSyncMutex.withLock {
            profileSync = synchronizeProfileDataSafely(profile.id)
        }
    }
    LaunchedEffect(activeProfile?.id, state.activeProfileId) {
        if (activeProfile != null && activeProfile.id != state.activeProfileId) {
            dispatch(AppAction.SelectProfile(activeProfile.id))
        }
    }
    var selectedMedia by remember { mutableStateOf<CatalogItem?>(null) }
    var selectedMediaReturnsToOrigin by remember { mutableStateOf(false) }
    var selectedMediaOpenMode by remember { mutableStateOf(MediaOpenMode.Details) }
    var selectedMediaBackRestore by remember { mutableStateOf<(() -> Unit)?>(null) }
    var profileFlowActive by remember { mutableStateOf(false) }
    var selectedVideoId by remember { mutableStateOf<String?>(null) }
    val homeListState = rememberLazyListState()
    val searchListState = rememberLazyListState()
    val discoverGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val libraryGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val continueWatchingGridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val settingsListState = rememberLazyListState()
    val homeCache = remember(activeProfile?.id) { HomeScreenCache() }
    var browseQuery by remember(activeProfile?.id) { mutableStateOf("") }
    var focusSearchOnOpen by remember(activeProfile?.id) { mutableStateOf(false) }
    var discoverSelection by remember(activeProfile?.id) { mutableStateOf(DiscoverSelection()) }
    var adaptiveScrolledDown by remember { mutableStateOf(false) }
    var profileLaunchRequest by remember { mutableStateOf<ProfileLaunchRequest?>(null) }
    var profileLaunchSequence by remember { mutableIntStateOf(0) }
    val closeSelectedMedia: () -> Unit = {
        selectedMedia = null
        selectedMediaReturnsToOrigin = false
        selectedMediaOpenMode = MediaOpenMode.Details
        selectedMediaBackRestore = null
    }
    val closeSelectedMediaInteractively: () -> Unit = {
        val previousMedia = selectedMedia
        val previousVideoId = selectedVideoId
        val previousReturnsToOrigin = selectedMediaReturnsToOrigin
        val previousOpenMode = selectedMediaOpenMode
        if (previousMedia != null) {
            selectedMediaBackRestore = {
                selectedMedia = previousMedia
                selectedVideoId = previousVideoId
                selectedMediaReturnsToOrigin = previousReturnsToOrigin
                selectedMediaOpenMode = previousOpenMode
            }
        }
        selectedMedia = null
        selectedMediaReturnsToOrigin = false
        selectedMediaOpenMode = MediaOpenMode.Details
    }
    val cancelSelectedMediaInteractiveClose: () -> Unit = {
        selectedMediaBackRestore?.invoke()
        selectedMediaBackRestore = null
    }
    fun openProfile(target: ProfileLaunchTarget, returnToLibrary: Boolean = false) {
        profileLaunchSequence += 1
        profileLaunchRequest = ProfileLaunchRequest(target, profileLaunchSequence, returnToLibrary)
        dispatch(AppAction.Navigate(AppDestination.Profile))
    }
    val refreshProfileData: () -> Unit = {
        activeProfile?.let { profile ->
            appScope.launch {
                profileSyncMutex.withLock {
                    profileSync = synchronizeProfileDataSafely(profile.id, fullResync = true)
                }
            }
        }
    }
    rememberAppRecoveryTriggers {
        activeProfile?.let { profile ->
            appScope.launch {
                profileSyncMutex.withLock {
                    profileSync = synchronizeProfileDataSafely(profile.id)
                }
            }
        }
    }
    LaunchedEffect(
        state.destination,
        browseQuery,
        homeListState,
        searchListState,
        discoverGridState,
        libraryGridState,
        continueWatchingGridState,
        settingsListState,
    ) {
        fun position(): Long = when (state.destination) {
            AppDestination.Home -> (homeListState.firstVisibleItemIndex.toLong() shl 32) or homeListState.firstVisibleItemScrollOffset.toLong()
            AppDestination.Search -> if (browseQuery.isBlank()) {
                (discoverGridState.firstVisibleItemIndex.toLong() shl 32) or discoverGridState.firstVisibleItemScrollOffset.toLong()
            } else {
                (searchListState.firstVisibleItemIndex.toLong() shl 32) or searchListState.firstVisibleItemScrollOffset.toLong()
            }
            AppDestination.Library -> (libraryGridState.firstVisibleItemIndex.toLong() shl 32) or libraryGridState.firstVisibleItemScrollOffset.toLong()
            AppDestination.Calendar -> 0L
            AppDestination.Profile -> (settingsListState.firstVisibleItemIndex.toLong() shl 32) or settingsListState.firstVisibleItemScrollOffset.toLong()
            AppDestination.ContinueWatching -> (continueWatchingGridState.firstVisibleItemIndex.toLong() shl 32) or continueWatchingGridState.firstVisibleItemScrollOffset.toLong()
        }
        var previous = position()
        adaptiveScrolledDown = previous != 0L
        snapshotFlow { position() }
            .collect { current ->
                if (current == 0L) adaptiveScrolledDown = false
                else if (current > previous) adaptiveScrolledDown = true
                else if (current < previous) adaptiveScrolledDown = false
                previous = current
            }
    }
    val selectMedia: (CatalogItem, String?) -> Unit = { item, videoId ->
        selectedMedia = item
        selectedVideoId = videoId
        selectedMediaReturnsToOrigin = false
        selectedMediaOpenMode = MediaOpenMode.Details
    }
        BoxWithConstraints(Modifier.fillMaxSize()) {
        // Desktop and browser windows use the approved compact rail by default.
        // Tablets keep their opt-in so resizing a phone does not replace its shell.
        val expanded = maxWidth >= 720.dp && maxHeight >= 600.dp &&
            (platform.usesDesktopWindowLayout() || preferences.railOnTablets)
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
                    val progressOperations = mutation.progressOperations()
                    if (progressOperations.isEmpty() || incrementalProgress == null) {
                        api.executeMutation(state.endpoint!!.baseUrl, account.session.token, profile.id, mutation)
                    } else {
                        progressOperations.forEach { operation ->
                            incrementalProgress.enqueue(endpoint.baseUrl, accountId, profile.id, operation)
                        }
                    }
                    if (mutation is ProfileMutation.SetQueue) syncRepository.clearPendingQueue(profile.id)
                    profileSyncMutex.withLock {
                        val synchronized = synchronizeProfileData(profile.id)
                        val postMutation = synchronized.snapshot?.let { snapshot ->
                            when (mutation) {
                                is ProfileMutation.SetQueue,
                                is ProfileMutation.SetDismissed,
                                is ProfileMutation.RemoveProgress -> snapshot.applyOptimistically(mutation)
                                else -> snapshot
                            }
                        }
                        if (postMutation != null) syncRepository.save(postMutation)
                        profileSync = synchronized.copy(snapshot = postMutation)
                    }
                }.recoverCatching { cause ->
                    if (mutation is ProfileMutation.SetQueue) {
                        syncRepository.savePendingQueue(profile.id, mutation.items)
                        profileSync = profileSync.copy(
                            snapshot = optimistic,
                            offline = true,
                            error = "Queue will sync when the server is reachable",
                        )
                        syncRepository.save(optimistic)
                    } else {
                        profileSync = profileSync.copy(snapshot = before, error = cause.message)
                        syncRepository.save(before)
                        throw cause
                    }
                }
            }
            result.exceptionOrNull()?.let { snackbarHostState.showSnackbar(it.message ?: "Unable to update this title") }
            if (result.isSuccess && mutation is ProfileMutation.SetLibrary && !mutation.saved) {
                if (snackbarHostState.showSnackbar(
                        message = "Removed from library",
                        actionLabel = "Undo",
                        duration = SnackbarDuration.Short,
                    ) == SnackbarResult.ActionPerformed
                ) {
                    mutateProfile(mutation.copy(saved = true))
                }
            }
            return result
        }
        val onPlaybackProgressChanged: (ProgressSummary) -> Unit = { saved ->
            val current = profileSync.snapshot
            if (current != null) {
                val updated = current.withProgressUpdate(saved)
                profileSync = profileSync.copy(snapshot = updated, offline = false, error = null)
                syncRepository.save(updated)
            }
        }
        val openMedia: (CatalogItem, String?) -> Unit = { item, videoId ->
            selectMedia(item, videoId)
            if (!state.richActionsHintShown) {
                dispatch(AppAction.RichActionsHintShown)
                appScope.launch { snackbarHostState.showSnackbar("Touch and hold a title for more options") }
            }
        }
        val openContinueWatching: (CatalogItem, String?) -> Unit = { item, videoId ->
            selectedMedia = item
            selectedVideoId = videoId
            selectedMediaReturnsToOrigin = true
            selectedMediaOpenMode = MediaOpenMode.AutoResume
            if (!state.richActionsHintShown) {
                dispatch(AppAction.RichActionsHintShown)
                appScope.launch { snackbarHostState.showSnackbar("Touch and hold a title for more options") }
            }
        }
        val openLibraryEntry: (CatalogItem, String?) -> Unit = { item, videoId ->
            selectedMedia = item
            selectedVideoId = videoId
            selectedMediaReturnsToOrigin = true
            selectedMediaOpenMode = MediaOpenMode.AutoResume
        }
        val openContinueWatchingDetails: (CatalogItem) -> Unit = { item ->
            selectedMedia = item
            selectedVideoId = null
            selectedMediaReturnsToOrigin = false
            selectedMediaOpenMode = MediaOpenMode.Details
        }
        val openQueuedItem: (PlaybackQueueItem) -> Unit = { queued ->
            selectedMedia = CatalogItem(
                id = queued.mediaId,
                type = queued.mediaType,
                name = queued.name,
                poster = queued.poster,
                background = queued.artwork,
            )
            selectedVideoId = queued.videoId
            selectedMediaReturnsToOrigin = false
            selectedMediaOpenMode = MediaOpenMode.Queue
        }
        val openBrowse: (MobileBrowseTarget) -> Unit = { target ->
            when (target) {
                is MobileBrowseTarget.Discover -> {
                    browseQuery = ""
                    discoverSelection = target.selection
                    focusSearchOnOpen = false
                }
                is MobileBrowseTarget.Search -> {
                    browseQuery = target.query
                    focusSearchOnOpen = true
                }
            }
            selectedMedia = null
            selectedMediaReturnsToOrigin = false
            dispatch(AppAction.Navigate(AppDestination.Search))
        }
        val openSearch: () -> Unit = {
            browseQuery = ""
            focusSearchOnOpen = true
            selectedMedia = null
            selectedMediaReturnsToOrigin = false
            dispatch(AppAction.Navigate(AppDestination.Search))
        }
        val navigateMain: (AppDestination) -> Unit = { destination ->
            if (destination != AppDestination.Search) browseQuery = ""
            if (destination == AppDestination.Profile) openProfile(ProfileLaunchTarget.Settings)
            else dispatch(AppAction.Navigate(destination))
        }
        LaunchedEffect(state.notice) {
            state.notice?.let {
                snackbarHostState.showSnackbar(it)
                dispatch(AppAction.DismissNotice)
            }
        }
        LaunchedEffect(Unit) {
            QueueToasts.notices.collect { notice ->
                snackbarHostState.showSnackbar(notice)
            }
        }
        Scaffold(
            snackbarHost = {
                SnackbarHost(snackbarHostState) { data -> ConduitSnackbar(data) }
            },
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
        ) { padding ->
            if (expanded) {
                Row(Modifier.fillMaxSize().padding(padding)) {
                    ConduitDesktopRail(
                        selected = state.destination,
                        onSelect = navigateMain,
                    )
                    Box(Modifier.weight(1f)) {
                        DestinationContent(
                            state, platform, account, activeProfile, profileSync, api, selectedMedia,
                            selectedVideoId, selectedMediaReturnsToOrigin, selectedMediaOpenMode,
                            openMedia, openLibraryEntry, openContinueWatching, openContinueWatchingDetails, openQueuedItem,
                            closeSelectedMedia, closeSelectedMediaInteractively, cancelSelectedMediaInteractiveClose, dispatch, onSignOut, onProfilesChanged,
                            { profileFlowActive = it },
                            refreshProfileData,
                            progressOutbox,
                            onPlaybackProgressChanged,
                            ::mutateProfile,
                            browseQuery, { browseQuery = it }, discoverSelection, { discoverSelection = it }, openBrowse,
                            { openProfile(ProfileLaunchTarget.History, returnToLibrary = true) },
                            preferences, onPreferencesChanged, homeListState, searchListState, discoverGridState, libraryGridState, continueWatchingGridState, settingsListState,
                            homeCache,
                            profileLaunchRequest,
                            playbackSession,
                            Modifier.fillMaxSize(),
                        )
                    }
                }
            } else {
                DestinationContent(
                    state, platform, account, activeProfile, profileSync, api, selectedMedia,
                    selectedVideoId, selectedMediaReturnsToOrigin, selectedMediaOpenMode,
                            openMedia, openLibraryEntry, openContinueWatching, openContinueWatchingDetails, openQueuedItem,
                            closeSelectedMedia, closeSelectedMediaInteractively, cancelSelectedMediaInteractiveClose, dispatch, onSignOut, onProfilesChanged,
                            { profileFlowActive = it },
                            refreshProfileData,
                            progressOutbox,
                            onPlaybackProgressChanged,
                    ::mutateProfile,
                    browseQuery, { browseQuery = it }, discoverSelection, { discoverSelection = it }, openBrowse,
                    { openProfile(ProfileLaunchTarget.History, returnToLibrary = true) },
                    preferences, onPreferencesChanged, homeListState, searchListState, discoverGridState, libraryGridState, continueWatchingGridState, settingsListState,
                    homeCache,
                    profileLaunchRequest,
                    playbackSession,
                    Modifier.padding(padding),
                )
            }
        }
        val initialLoading = activeProfile != null && selectedMedia == null &&
            playbackSession.state.presentation == PlaybackPresentation.Closed &&
            (if (profileSync.snapshot == null) {
                profileSync.refreshing && profileSync.error == null
            } else {
                homeCache.result.value == null && homeCache.catalogError.value == null
            })
        val playbackAllowsAppChrome = playbackSession.state.presentation in setOf(
            PlaybackPresentation.Closed,
            PlaybackPresentation.Mini,
        )
        val topChromeVisible = !initialLoading && playbackAllowsAppChrome && selectedMedia == null && state.destination in setOf(
            AppDestination.Home,
            AppDestination.Search,
            AppDestination.Library,
        )
        val bottomChromeVisible = !initialLoading && playbackAllowsAppChrome && selectedMedia == null && state.destination in setOf(
            AppDestination.Home,
            AppDestination.Search,
            AppDestination.Library,
            AppDestination.Profile,
            AppDestination.ContinueWatching,
        )
        if (topChromeVisible) {
            MainTopBar(
                profiles = profiles,
                activeProfile = activeProfile,
                query = browseQuery,
                onQueryChange = { value ->
                    browseQuery = value
                    if (state.destination != AppDestination.Search) {
                        dispatch(AppAction.Navigate(AppDestination.Search))
                    }
                },
                requestSearchFocus = focusSearchOnOpen,
                onSearchFocusConsumed = { focusSearchOnOpen = false },
                onSelectProfile = { dispatch(AppAction.SelectProfile(it)) },
                onOpenHome = { navigateMain(AppDestination.Home) },
                onAddProfile = { openProfile(ProfileLaunchTarget.Manage) },
                onOpenAddons = { openProfile(ProfileLaunchTarget.Addons) },
                onOpenSettings = { openProfile(ProfileLaunchTarget.Settings) },
                queueSize = profileSync.snapshot?.queue?.size ?: 0,
                onOpenQueue = { queueManagerOpen = true },
                onSignOut = onSignOut,
                modifier = Modifier.align(Alignment.TopCenter)
                    .then(if (expanded) Modifier.padding(start = 80.dp) else Modifier),
            )
        }
        val isIpad = platform.isIpad()
        val isTablet = platform.isTablet
        val keyboardVisible = isIpad && PlatformKeyboard.visible
        val appBottomNavigationVisible = !initialLoading && !expanded && bottomChromeVisible &&
            (!profileFlowActive || state.destination == AppDestination.Profile) &&
            !keyboardVisible
        if (!expanded) {
            // Adaptive remains the phone default. On iPad it resolves to the
            // full-width native tab bar unless the user explicitly chooses the
            // expanded floating treatment.
            val ipadUsesClassicBar = isIpad && preferences.navigationStyle != NavigationStyle.Expanded
            val classic = ipadUsesClassicBar || preferences.navigationStyle == NavigationStyle.Classic
            val compact = !isIpad && (preferences.navigationStyle == NavigationStyle.Compact ||
                (preferences.navigationStyle == NavigationStyle.Adaptive && adaptiveScrolledDown))
            val destinations = AppDestination.entries.filter(AppDestination::showInNavigation)
            // Keep the originating tab highlighted on contextual screens such as
            // watch history: Library when opened from the library header,
            // otherwise the default Home fallback.
            val fromLibraryHistory = state.destination == AppDestination.Profile &&
                profileFlowActive &&
                profileLaunchRequest?.let {
                    it.target == ProfileLaunchTarget.History && it.returnToLibrary
                } == true
            PlatformBottomNavigation(
                destinations = destinations,
                selected = if (fromLibraryHistory) {
                    AppDestination.Library
                } else {
                    state.destination.takeIf { it.showInNavigation } ?: AppDestination.Home
                },
                compact = compact,
                classic = classic,
                adaptive = !isIpad && preferences.navigationStyle == NavigationStyle.Adaptive,
                adaptiveHidden = !isIpad && preferences.navigationStyle == NavigationStyle.Adaptive && adaptiveScrolledDown,
                visible = appBottomNavigationVisible,
                onSelect = navigateMain,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
        PlaybackSessionHost(
            controller = playbackSession,
            preferences = preferences,
            expanded = expanded,
            isTablet = isTablet,
            isIpad = isIpad,
            bottomNavigationVisible = appBottomNavigationVisible,
            snapshot = profileSync.snapshot,
            onMutation = ::mutateProfile,
            skipSegmentsRepository = remember { SkipSegmentsRepository() },
        )
        if (queueManagerOpen && playbackSession.state.request == null) {
            PlaybackQueueDrawer(
                items = profileSync.snapshot?.queue.orEmpty(),
                onClose = { queueManagerOpen = false },
                onPlay = { item -> queueManagerOpen = false; openQueuedItem(item) },
                onChange = { items -> mutateProfile(ProfileMutation.SetQueue(items)) },
            )
        }
        if (initialLoading) {
            Surface(
                onClick = {},
                modifier = Modifier.fillMaxSize(),
                color = Color.Transparent,
            ) {
                ConduitLoadingScreen("LOADING YOUR HOME")
            }
        }
    }
}

private fun ProfileMutation.progressOperations(): List<ProgressOperation> = when (this) {
    is ProfileMutation.SetDismissed -> listOf(
        if (dismissed) ProgressOperation.DismissTitle(progress.identity())
        else ProgressOperation.RestoreTitle(progress.identity()),
    )
    is ProfileMutation.RemoveProgress -> listOf(ProgressOperation.DeleteEpisode(progress.identity()))
    is ProfileMutation.SetWatched -> {
        val current = progress
        val videoId = current?.videoId ?: video?.id ?: item.id
        val duration = current?.durationMs ?: 0
        listOf(
            ProgressOperation.Upsert(
                identity = ProgressIdentity(item.type, item.id, videoId = videoId, season = video?.season ?: current?.season, episode = video?.episode ?: current?.episode),
                name = item.name,
                poster = item.poster,
                videoTitle = video?.title ?: current?.videoTitle,
                positionMs = if (watched) duration else 0,
                durationMs = duration,
                watched = watched,
                playbackSource = current?.playbackSource,
                checkpointSessionId = "manual:${Clock.System.now()}",
                checkpointSequence = 1,
            ),
        )
    }
    is ProfileMutation.SetSeriesWatched -> videos
        .filter { video -> watched || progress.any { it.videoId == video.id } }
        .map { video ->
            val current = progress.firstOrNull { it.videoId == video.id }
            val duration = current?.durationMs ?: 0
            ProgressOperation.Upsert(
                identity = ProgressIdentity(item.type, item.id, videoId = video.id, season = video.season, episode = video.episode),
                name = item.name,
                poster = item.poster,
                videoTitle = video.title,
                positionMs = if (watched) duration else 0,
                durationMs = duration,
                watched = watched,
                playbackSource = current?.playbackSource,
                checkpointSessionId = "manual:${Clock.System.now()}:${video.id}",
                checkpointSequence = 1,
            )
        }
    is ProfileMutation.SetLibrary,
    is ProfileMutation.SetQueue -> emptyList()
}

private fun ProgressSummary.identity() = ProgressIdentity(
    canonicalTitleId = canonicalTitleId,
    mediaType = mediaType,
    mediaId = mediaId,
    videoId = videoId,
    season = season,
    episode = episode,
)

@Composable
private fun ConduitSnackbar(data: SnackbarData) {
    val removed = data.visuals.message == "Removed from library"
    var dragOffset by remember(data) { mutableFloatStateOf(0f) }
    Surface(
        modifier = Modifier
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .graphicsLayer {
                translationX = dragOffset
                alpha = 1f - (abs(dragOffset) / (size.width.coerceAtLeast(1f) * .9f)).coerceIn(0f, .7f)
            }
            .pointerInput(data) {
                detectHorizontalDragGestures(
                    onHorizontalDrag = { change, amount ->
                        change.consume()
                        dragOffset += amount
                    },
                    onDragEnd = {
                        if (abs(dragOffset) >= size.width * .25f) data.dismiss() else dragOffset = 0f
                    },
                    onDragCancel = { dragOffset = 0f },
                )
            },
        color = Color(0xFF151518),
        contentColor = Color.White,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .16f)),
        shadowElevation = 12.dp,
    ) {
        Row(
            Modifier.padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(
                if (removed) Icons.Rounded.BookmarkRemove else Icons.Rounded.CheckCircle,
                contentDescription = null,
                tint = if (removed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(data.visuals.message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            data.visuals.actionLabel?.let { actionLabel ->
                TextButton(onClick = data::performAction) {
                    Text(actionLabel, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
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
    selectedMediaReturnsToOrigin: Boolean,
    selectedMediaOpenMode: MediaOpenMode,
    onSelectMedia: (CatalogItem, String?) -> Unit,
    onSelectLibraryEntry: (CatalogItem, String?) -> Unit,
    onSelectContinueWatching: (CatalogItem, String?) -> Unit,
    onSelectContinueWatchingDetails: (CatalogItem) -> Unit,
    onSelectQueuedItem: (PlaybackQueueItem) -> Unit,
    onCloseMedia: () -> Unit,
    onInteractiveCloseMedia: () -> Unit,
    onCancelInteractiveCloseMedia: () -> Unit,
    dispatch: (AppAction) -> Unit,
    onSignOut: () -> Unit,
    onProfilesChanged: (String?) -> Unit,
    onProfileFlowChanged: (Boolean) -> Unit,
    onProfileDataChanged: () -> Unit,
    progressOutbox: PlaybackProgressOutbox,
    onPlaybackProgressChanged: (ProgressSummary) -> Unit,
    onProfileMutation: suspend (ProfileMutation) -> Result<Unit>,
    browseQuery: String,
    onBrowseQueryChange: (String) -> Unit,
    discoverSelection: DiscoverSelection,
    onDiscoverSelectionChange: (DiscoverSelection) -> Unit,
    onBrowse: (MobileBrowseTarget) -> Unit,
    onOpenHistoryFromLibrary: () -> Unit,
    preferences: DevicePreferences,
    onPreferencesChanged: (DevicePreferences) -> Unit,
    homeListState: androidx.compose.foundation.lazy.LazyListState,
    searchListState: androidx.compose.foundation.lazy.LazyListState,
    discoverGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    libraryGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    continueWatchingGridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    settingsListState: androidx.compose.foundation.lazy.LazyListState,
    homeCache: HomeScreenCache,
    profileLaunchRequest: ProfileLaunchRequest?,
    playbackSession: PlaybackSessionController,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.destination) {
        if (state.destination != AppDestination.Profile) onProfileFlowChanged(false)
        if (state.destination == AppDestination.Home || state.destination == AppDestination.ContinueWatching) {
            onProfileDataChanged()
        }
    }
    Box(modifier.fillMaxSize()) {
        AppDestination.entries.forEach { destination ->
            val active = selectedMedia == null && state.destination == destination
            val tabModifier = if (active) Modifier.fillMaxSize() else Modifier.size(0.dp)
            when (destination) {
                AppDestination.Home -> HomeScreen(
                    profileSync, api, onSelectMedia, onSelectContinueWatching, onSelectContinueWatchingDetails, onProfileMutation,
                    onOpenContinueWatching = { dispatch(AppAction.Navigate(AppDestination.ContinueWatching)) },
                    onOpenDiscover = { onBrowse(MobileBrowseTarget.Discover(it)) },
                    listState = homeListState, cache = homeCache, modifier = tabModifier,
                )
                AppDestination.Search -> SearchDiscoverScreen(
                    addons = profileSync.snapshot?.addons.orEmpty(), api = api,
                    snapshot = profileSync.snapshot, query = browseQuery, onQueryChange = onBrowseQueryChange,
                    selection = discoverSelection, onSelectionChange = onDiscoverSelectionChange,
                    onMutation = onProfileMutation,
                    onSelect = { item, videoId -> onSelectMedia(item, videoId) }, listState = searchListState,
                    gridState = discoverGridState, modifier = tabModifier,
                )
                AppDestination.Library -> MobileLibraryScreen(
                    snapshot = profileSync.snapshot, api = api, onMutation = onProfileMutation,
                    onOpenHistory = onOpenHistoryFromLibrary,
                    onOpenCalendar = { dispatch(AppAction.Navigate(AppDestination.Calendar)) },
                    onSelect = { onSelectMedia(it, null) }, onSelectVideo = onSelectLibraryEntry,
                    gridState = libraryGridState, modifier = tabModifier,
                )
                AppDestination.Calendar -> MobileCalendarScreen(
                    snapshot = profileSync.snapshot,
                    api = api,
                    active = active,
                    onBack = { dispatch(AppAction.Navigate(AppDestination.Library)) },
                    onBackCancelled = { dispatch(AppAction.Navigate(AppDestination.Calendar)) },
                    onSelect = onSelectMedia,
                    modifier = tabModifier,
                )
                AppDestination.Profile -> ProfileSettingsScreen(
                    state, platform, account, activeProfile, profileSync, api, active, dispatch, onSignOut,
                    onProfilesChanged, { if (active) onProfileFlowChanged(it) }, onProfileDataChanged,
                    onProfileMutation, onSelectMedia,
                    preferences, onPreferencesChanged, settingsListState = settingsListState,
                    launchRequest = profileLaunchRequest, modifier = tabModifier,
                )
                AppDestination.ContinueWatching -> MobileContinueWatchingScreen(
                    snapshot = profileSync.snapshot, api = api, onMutation = onProfileMutation,
                    active = active,
                    onBack = { dispatch(AppAction.Navigate(AppDestination.Home)) },
                    onBackCancelled = { dispatch(AppAction.Navigate(AppDestination.ContinueWatching)) },
                    onSelect = onSelectContinueWatchingDetails, onSelectVideo = onSelectContinueWatching,
                    gridState = continueWatchingGridState, modifier = tabModifier,
                )
            }
        }
        if (selectedMedia != null) {
            key(MediaDetailsInstanceKey(selectedMedia.type, selectedMedia.id, selectedVideoId, selectedMediaOpenMode)) {
                MediaDetailsScreen(
                    item = selectedMedia,
                    initialVideoId = selectedVideoId,
                    returnToHomeOnStreamBack = selectedMediaReturnsToOrigin,
                    openMode = selectedMediaOpenMode,
                    addons = profileSync.snapshot?.addons.orEmpty(),
                    api = api,
                    progressOutbox = progressOutbox,
                    profile = activeProfile,
                    snapshot = profileSync.snapshot,
                    baseUrl = state.endpoint!!.baseUrl,
                    token = account.session.token,
                    accountId = account.bootstrap.user?.email ?: account.session.token,
                    preferences = preferences,
                    onPreferencesChanged = onPreferencesChanged,
                    onProgressChanged = onPlaybackProgressChanged,
                    onMutation = onProfileMutation,
                    onBrowse = onBrowse,
                    onPlayQueueItem = onSelectQueuedItem,
                    onBack = onCloseMedia,
                    onInteractiveBack = onInteractiveCloseMedia,
                    onBackCancelled = onCancelInteractiveCloseMedia,
                    playbackSession = playbackSession,
                )
            }
        }
        if (profileSync.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
    }
}

@Composable
private fun BoxScope.PlaybackSessionHost(
    controller: PlaybackSessionController,
    preferences: DevicePreferences,
    expanded: Boolean,
    isTablet: Boolean,
    isIpad: Boolean,
    bottomNavigationVisible: Boolean,
    snapshot: ProfileSnapshot?,
    onMutation: suspend (ProfileMutation) -> Result<Unit>,
    skipSegmentsRepository: SkipSegmentsRepository,
) {
    val scope = rememberCoroutineScope()
    val session = controller.state
    val request = session.request ?: return
    val upNext = playbackUpNext(request, snapshot?.queue.orEmpty())
    SideEffect {
        controller.updateQueuedNext(request.identity, upNext?.queuedItem)
    }
    var skipSegments by remember(request.identity.mediaId, request.season, request.episode) {
        mutableStateOf<List<SkipSegment>>(emptyList())
    }
    LaunchedEffect(request.identity.mediaId, request.season, request.episode) {
        skipSegments = skipSegmentsRepository.forEpisode(
            mediaId = request.identity.mediaId,
            season = request.season,
            episode = request.episode,
        )
    }
    val fullScreen = session.presentation == PlaybackPresentation.FullScreen
    val systemPip = session.presentation == PlaybackPresentation.SystemPip
    val pipHandoffVisible = systemPip && systemPipKeepsAppVisible
    val pipActionReady = isSystemPipActionReady(session.systemPipAvailable, session.playback)
    var controlsVisible by remember(request.identity, request.url) { mutableStateOf(true) }
    var upNextDismissed by remember(request.identity.mediaId, request.identity.videoId) {
        mutableStateOf(false)
    }
    var skipPromptReveal by remember(request.identity.mediaId, request.identity.videoId) {
        mutableIntStateOf(0)
    }
    var skipPromptVisible by remember(request.identity.mediaId, request.identity.videoId) {
        mutableStateOf(false)
    }
    val skipPromptProgress = remember(request.identity.mediaId, request.identity.videoId) {
        Animatable(1f)
    }
    var playerOverlayVisible by remember(request.identity, request.url) { mutableStateOf(false) }
    var temporarySpeedActive by remember(request.identity, request.url) { mutableStateOf(false) }
    var miniOffset by remember(request.identity, request.url) { mutableStateOf(IntOffset.Zero) }
    var miniWidthDp by remember(request.identity, request.url, expanded, isTablet) {
        mutableFloatStateOf(if (expanded || isTablet) 320f else 220f)
    }
    var miniDockedLeft by remember(request.identity, request.url) { mutableStateOf(false) }
    var miniDockedTop by remember(request.identity, request.url) { mutableStateOf(false) }
    var miniGestureActive by remember(request.identity, request.url) { mutableStateOf(false) }
    var playbackHasStarted by remember(request.identity, request.url) { mutableStateOf(false) }
    var consumedQueueItemKey by remember(session.sessionId) { mutableStateOf<String?>(null) }
    var startupRecoveryRequested by remember(session.sessionId) { mutableStateOf(false) }
    var containerSize by remember { mutableStateOf(IntSize.Zero) }
    var miniSize by remember { mutableStateOf(IntSize.Zero) }
    val playbackSurfaceReady = session.playback.videoWidth > 0 && session.playback.videoHeight > 0
    val density = LocalDensity.current
    val animatedMiniOffset by animateIntOffsetAsState(
        targetValue = miniOffset,
        animationSpec = spring(dampingRatio = .78f, stiffness = 520f),
        label = "mini-player-corner",
    )

    PlayerOrientationLock(
        active = session.presentation == PlaybackPresentation.FullScreen,
    )
    LaunchedEffect(request.identity, request.url) {
        while (true) {
            kotlinx.coroutines.delay(15_000)
            controller.persist()
        }
    }
    LaunchedEffect(session.playback.ended) {
        if (session.playback.ended) controller.persist()
    }
    LaunchedEffect(
        request.identity.videoId,
        request.url,
        upNext?.queuedItem?.key,
        upNext?.nextEpisodeTitle,
        preferences.autoplayNextEpisode,
        session.playback.ended,
    ) {
        if (
            preferences.autoplayNextEpisode &&
                upNext != null &&
                session.playback.ended
        ) {
            // Autoplay uses the same bounded source-resolution path as an
            // explicit Next action.
            controller.playNext()
        }
    }
    LaunchedEffect(
        session.sessionId,
        request.identity,
        session.playback.playing,
        session.playback.loading,
        session.playback.buffering,
        playbackSurfaceReady,
        snapshot?.queue?.firstOrNull { item ->
            item.mediaId == request.identity.mediaId && item.videoId == request.identity.videoId
        }?.key,
    ) {
        if (
            session.playback.playing &&
                !session.playback.loading &&
                !session.playback.buffering &&
                playbackSurfaceReady
        ) {
            playbackHasStarted = true
        }
        // Queue consumption belongs to the session host because it observes the
        // authoritative request and playback state for every playback entry point.
        if (!session.playback.loading && !session.playback.buffering && playbackSurfaceReady) {
            val queued = snapshot?.queue.orEmpty()
            val consumed = queued.firstOrNull { item ->
                item.mediaId == request.identity.mediaId && item.videoId == request.identity.videoId
            }
            if (consumed != null && consumedQueueItemKey != consumed.key) {
                consumedQueueItemKey = consumed.key
                val remainingQueue = queueAfterPlaybackStarted(
                    queued,
                    request.identity.mediaId,
                    request.identity.videoId,
                )
                onMutation(ProfileMutation.SetQueue(remainingQueue))
            }
        }
        if (!session.playback.playing && session.playback.durationMs > 0) controller.persist()
    }
    LaunchedEffect(session.sessionId, request.url, request.autoRecoveryAttempt) {
        if (!request.autoRecoveryAttempt) return@LaunchedEffect
        kotlinx.coroutines.delay(8_000)
        val current = controller.state
        val playback = current.playback
        if (
            current.sessionId == session.sessionId &&
            current.request?.streamKeyForPlayback() == request.streamKeyForPlayback() &&
            savedStreamStartupStalled(request, playback) &&
            !startupRecoveryRequested
        ) {
            startupRecoveryRequested = true
            controller.autoRecoveryFailed(
                session.sessionId,
                "Saved stream failed to start. Choose another stream.",
            )
        }
    }
    LaunchedEffect(session.playback.error) {
        if (
            session.playback.error != null &&
            savedStreamStartupStalled(request, session.playback) &&
            !startupRecoveryRequested
        ) {
            startupRecoveryRequested = true
            controller.autoRecoveryFailed(
                session.sessionId,
                "Saved stream failed to start. Choose another stream.",
            )
        } else if (
            session.playback.error != null &&
            manualSourceSwitchStartupStalled(request, session.playback) &&
            !startupRecoveryRequested
        ) {
            startupRecoveryRequested = true
            controller.manualSourceSwitchFailed(session.sessionId)
        }
    }
    LaunchedEffect(session.notice) {
        if (session.notice != null) {
            kotlinx.coroutines.delay(3_000)
            controller.dismissNotice()
        }
    }

    var interactiveBackRestore by remember { mutableStateOf<(() -> Unit)?>(null) }
    val interactiveBackAvailable = fullScreen &&
        (session.episodePickerOpen || session.streamPicker != null || session.queueOpen)
    fun performNativeBack() {
        when {
            session.queueOpen -> {
                interactiveBackRestore = { controller.openQueue() }
                controller.closeQueue()
            }
            session.streamPicker != null -> {
                val picker = session.streamPicker
                interactiveBackRestore = { controller.showStreamPicker(picker) }
                controller.closeStreamPicker()
            }
            session.episodePickerOpen -> {
                interactiveBackRestore = { controller.openEpisodes() }
                controller.closeEpisodes()
            }
        }
    }
    fun cancelNativeBack() {
        interactiveBackRestore?.invoke()
        interactiveBackRestore = null
    }
    PlatformBackHandler(
        enabled = fullScreen && (session.episodePickerOpen || session.streamPicker != null || session.queueOpen),
        onBack = ::performNativeBack,
        onBackCancelled = ::cancelNativeBack,
        interactiveBack = interactiveBackAvailable,
    )
    val initialPlaybackLoad = !playbackHasStarted &&
        (session.playback.loading || session.playback.buffering || !playbackSurfaceReady)
    val playbackTransition = session.transition
    val transitionStatus = when {
        playbackTransition == null -> null
        session.streamPicker != null && !session.streamPicker.loading -> "Choose a source"
        else -> "Finding source…"
    }
    val presentPlaybackError = shouldPresentPlaybackError(
        request,
        session.playback,
        session.autoRecoveryExhausted,
    )
    val showPlaybackActions = fullScreen &&
        !pipHandoffVisible &&
        playbackSurfaceReady &&
        playbackTransition == null &&
        !session.playback.loading &&
        !session.playback.buffering &&
        !presentPlaybackError
    val upNextAvailable = fullScreen &&
        upNext != null &&
        playbackTransition == null &&
        shouldShowUpNextBanner(
            positionMs = session.playback.positionMs,
            durationMs = session.playback.durationMs,
            segments = skipSegments,
        )
    val upNextVisible = upNextAvailable && !upNextDismissed
    LaunchedEffect(upNextAvailable, session.sessionId, request.identity.videoId) {
        // Start resolving the next episode while credits roll so tapping Play
        // next (or autoplay at the end) swaps streams without waiting.
        if (upNextAvailable) controller.prefetchUpNext()
    }
    val activeSkip = if (fullScreen && playbackTransition == null && preferences.skipSegments) {
        activeSkipSegment(session.playback.positionMs, skipSegments)
    } else null
    LaunchedEffect(activeSkip) {
        if (activeSkip == null) {
            skipPromptVisible = false
        } else {
            skipPromptReveal += 1
        }
    }
    LaunchedEffect(controlsVisible) {
        if (controlsVisible && activeSkip != null) skipPromptReveal += 1
    }
    LaunchedEffect(skipPromptReveal) {
        if (skipPromptReveal == 0) return@LaunchedEffect
        skipPromptVisible = true
        skipPromptProgress.snapTo(1f)
        skipPromptProgress.animateTo(
            targetValue = 0f,
            animationSpec = tween(SKIP_PROMPT_VISIBLE_MS.toInt(), easing = LinearEasing),
        )
        skipPromptVisible = false
    }

    Box(Modifier.fillMaxSize().onSizeChanged { containerSize = it }) {
        // Adaptive iOS hides the native bar, but the mini-player keeps its
        // corner position so scrolling does not make it jump vertically.
        val miniBottomPadding = if (bottomNavigationVisible) 116.dp else 12.dp
        val renderedMiniOffset = if (miniGestureActive) miniOffset else animatedMiniOffset
        val miniAspectRatio = playbackAspectRatio(
            session.playback.videoWidth,
            session.playback.videoHeight,
        )
        val miniLayout = Modifier
            .align(Alignment.BottomEnd)
            .padding(end = 12.dp, bottom = miniBottomPadding)
            .offset { renderedMiniOffset }
            .width(miniWidthDp.dp)
            .aspectRatio(miniAspectRatio)
        val playerModifier = if (fullScreen || systemPip) {
            Modifier.fillMaxSize()
        } else {
            miniLayout.clip(RoundedCornerShape(10.dp))
        }
        // Dispose the old native player before resolving the next episode. On iOS,
        // this prevents slow external-subtitle commands from blocking the new load.
        if (playbackTransition == null) {
            NativePlayer(
                url = request.url,
                active = true,
                presentation = session.presentation,
                command = session.command,
                startPositionMs = request.startPositionMs,
                requestHeaders = request.requestHeaders,
                subtitles = request.subtitles,
                contentLogo = request.logo,
                contentTitle = request.title,
                hasNextEpisode = upNext != null,
                onNextEpisode = controller::playNext,
                hasEpisodes = request.hasEpisodes,
                onEpisodes = controller::openEpisodes,
                hasSources = true,
                onSources = controller::openSources,
                touchGestures = preferences.touchGestures,
                holdToSpeed = preferences.holdToSpeed,
                preferredAudioLanguage = preferences.preferredAudioLanguage,
                preferredSubtitleLanguage = preferences.preferredSubtitleLanguage,
                androidPlaybackEngine = preferences.androidPlaybackEngine,
                onControlsVisibilityChanged = { controlsVisible = it },
                onOverlayVisibilityChanged = { playerOverlayVisible = it },
                onTemporarySpeedChanged = { temporarySpeedActive = it },
                onSystemPipChanged = controller::systemPipChanged,
                onSystemPipAvailabilityChanged = controller::systemPipAvailabilityChanged,
                interactiveResize = miniGestureActive,
                modifier = playerModifier,
                onState = { playback ->
                    controller.updatePlayback(
                        session.sessionId,
                        request.streamKeyForPlayback(),
                        playback,
                    )
                },
            )
        }

        if (systemPip) {
            // The native player must keep decoding for PiP, but its inline
            // surface should not remain visible underneath the PiP window.
            Box(Modifier.matchParentSize().background(Color.Black))
        }

        if (fullScreen || pipHandoffVisible) {
            if ((initialPlaybackLoad || playbackTransition != null) && !presentPlaybackError) {
                PlayerOpeningOverlay(
                    artwork = playbackTransition?.artwork ?: request.artwork,
                    logo = playbackTransition?.logo ?: request.logo,
                    title = playbackTransition?.title ?: request.mediaName,
                    status = transitionStatus,
                    modifier = Modifier.matchParentSize(),
                )
            }
            if (fullScreen && session.playback.buffering && !initialPlaybackLoad && !presentPlaybackError) {
                PlayerBufferingOverlay(Modifier.matchParentSize())
            }
            if ((controlsVisible && !playerOverlayVisible) || pipHandoffVisible) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .statusBarsPadding()
                        .padding(top = windowedIpadTopInset())
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (pipHandoffVisible) {
                        IconButton(
                            onClick = controller::close,
                            modifier = Modifier.background(Color.Black.copy(.55f), androidx.compose.foundation.shape.CircleShape),
                        ) { Icon(Icons.Rounded.Close, "Close player", tint = Color.White) }
                    } else {
                        PlayerBackButton {
                            if (playbackTransition != null) controller.close()
                            else controller.leaveFullScreen(preferences.miniplayerOnBack)
                        }
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        playbackTransition?.title ?: request.title,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (showPlaybackActions) {
                        BadgedBox(
                            badge = {
                                val count = snapshot?.queue?.size ?: 0
                                if (count > 0) Badge { Text(count.coerceAtMost(99).toString()) }
                            },
                        ) {
                            IconButton(
                                onClick = controller::openQueue,
                            ) { Icon(Icons.Rounded.QueueMusic, "Queue", tint = Color.White) }
                        }
                    }
                    if (showPlaybackActions && pipActionReady) {
                        IconButton(
                            onClick = { controller.send(PlaybackCommand.EnterSystemPip) },
                        ) { Icon(Icons.Rounded.PictureInPictureAlt, "Picture in Picture", tint = Color.White) }
                    }
                }
            }
            if (pipHandoffVisible) {
                PipHandoffIndicator(Modifier.matchParentSize())
            }
            if (temporarySpeedActive) {
                Text(
                    "» 2×",
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 12.dp)
                        .background(Color.Black.copy(.72f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
            session.notice?.let { notice ->
                Surface(
                    modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 24.dp),
                    color = Color(0xF0202022),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Color.White.copy(.14f)),
                ) { Text(notice, color = Color.White, modifier = Modifier.padding(horizontal = 16.dp, vertical = 11.dp)) }
            }
            if (fullScreen && presentPlaybackError) (session.playback.error ?: session.recoveryError)?.let { message ->
                Box(Modifier.matchParentSize().background(Color.Black.copy(.58f))) {
                    Surface(
                        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
                        color = Color(0xFA08080A),
                        tonalElevation = 0.dp,
                        shadowElevation = 18.dp,
                    ) {
                        Column(
                            Modifier.navigationBarsPadding().padding(horizontal = 22.dp, vertical = 18.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text("Couldn't start this video", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text(message, color = Color.White.copy(.72f), style = MaterialTheme.typography.bodyMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Button(onClick = if (request.autoRecoveryAttempt) controller::retryAutoRecovery else {
                                    { controller.send(PlaybackCommand.RetryVideoOutput) }
                                }) { Text("Retry") }
                                OutlinedButton(onClick = controller::openSources) { Text("Choose source") }
                                val failedQueued = snapshot?.queue?.firstOrNull { queued ->
                                    queued.mediaId == request.identity.mediaId && queued.videoId == request.identity.videoId
                                }
                                if (failedQueued != null) {
                                    OutlinedButton(onClick = {
                                        scope.launch {
                                            val remaining = snapshot.queue.removeFromQueue(failedQueued.key)
                                            if (onMutation(ProfileMutation.SetQueue(remaining)).isSuccess) {
                                                remaining.firstOrNull()?.let(controller::playQueueItem) ?: controller.close()
                                            }
                                        }
                                    }) { Text("Skip item") }
                                }
                                OutlinedButton(onClick = controller::close) { Text("Close") }
                            }
                        }
                    }
                }
            }
            val compactUpNext = with(density) {
                containerSize.width.toDp() < 600.dp || containerSize.height.toDp() < 600.dp
            }
            val overlayBottomPadding = when {
                !controlsVisible -> 18.dp
                compactUpNext -> 132.dp
                else -> 102.dp
            }
            val skipOnRight = isIpad && preferences.skipButtonPosition == SkipButtonPosition.Right
            val skipBottomPadding = overlayBottomPadding + if (skipOnRight && upNextVisible) {
                if (compactUpNext) 84.dp else 96.dp
            } else {
                0.dp
            }
            if (upNextVisible) {
                Surface(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.End))
                        .padding(end = 18.dp, bottom = overlayBottomPadding)
                        .widthIn(
                            min = if (compactUpNext) 280.dp else 300.dp,
                            max = if (compactUpNext) 320.dp else 365.dp,
                        ),
                    color = Color(0xE619191B),
                    shape = RoundedCornerShape(if (compactUpNext) 16.dp else 20.dp),
                    border = BorderStroke(1.dp, Color.White.copy(.16f)),
                ) {
                    Box {
                        Row(
                            Modifier.padding(
                                start = if (compactUpNext) 8.dp else 10.dp,
                                top = if (compactUpNext) 8.dp else 10.dp,
                                end = if (compactUpNext) 40.dp else 44.dp,
                                bottom = if (compactUpNext) 8.dp else 10.dp,
                            ),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AsyncImage(
                                upNext.nextEpisodeArtwork,
                                null,
                                Modifier
                                    .size(
                                        width = if (compactUpNext) 68.dp else 80.dp,
                                        height = if (compactUpNext) 46.dp else 52.dp,
                                    )
                                    .clip(RoundedCornerShape(if (compactUpNext) 9.dp else 11.dp)),
                                contentScale = ContentScale.Crop,
                            )
                            Spacer(Modifier.width(if (compactUpNext) 8.dp else 10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    listOfNotNull(
                                        if (upNext.nextItemQueued) "UP NEXT" else "NEXT EPISODE",
                                        upNext.episodeLabel,
                                    ).joinToString(" · "),
                                    color = Color.White.copy(.6f),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                                Text(
                                    upNext.nextEpisodeTitle.orEmpty(),
                                    color = Color.White,
                                    fontSize = if (compactUpNext) 14.sp else 15.sp,
                                    lineHeight = if (compactUpNext) 16.sp else 18.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            FilledTonalIconButton(
                                onClick = controller::playNext,
                                modifier = Modifier.size(36.dp),
                            ) {
                                Icon(Icons.Rounded.PlayArrow, "Play next")
                            }
                        }
                        Surface(
                            onClick = { upNextDismissed = true },
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(6.dp)
                                .size(28.dp),
                            color = Color.White.copy(.10f),
                            contentColor = Color.White,
                            shape = CircleShape,
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Rounded.Close,
                                    "Dismiss next episode",
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                        }
                    }
                }
            }
            if (activeSkip != null && skipPromptVisible) {
                Surface(
                    onClick = { controller.send(PlaybackCommand.SeekTo(activeSkip.endMs)) },
                    modifier = Modifier
                        .align(if (skipOnRight) Alignment.BottomEnd else Alignment.BottomStart)
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(
                                if (skipOnRight) WindowInsetsSides.End else WindowInsetsSides.Start,
                            ),
                        )
                        .padding(
                            start = if (skipOnRight) 0.dp else 18.dp,
                            end = if (skipOnRight) 18.dp else 0.dp,
                            bottom = skipBottomPadding,
                        ),
                    color = Color(0xE619191B),
                    contentColor = Color.White,
                    shape = RoundedCornerShape(if (compactUpNext) 14.dp else 16.dp),
                    border = BorderStroke(1.dp, Color.White.copy(.16f)),
                ) {
                    Box {
                        Canvas(Modifier.matchParentSize()) {
                            drawRect(
                                color = Color.White.copy(.12f),
                                size = Size(
                                    this.size.width * skipPromptProgress.value,
                                    this.size.height,
                                ),
                            )
                        }
                        Row(
                            Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Rounded.FastForward,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                skipSegmentLabel(activeSkip.type),
                                fontWeight = FontWeight.SemiBold,
                                style = MaterialTheme.typography.labelLarge,
                            )
                        }
                    }
                }
            }
            if (fullScreen && session.episodePickerOpen && request.episodes.isNotEmpty() && request.mediaItem != null) {
                PlayerEpisodeDrawer(
                    videos = request.episodes,
                    current = request.episodes.firstOrNull { it.id == request.identity.videoId },
                    snapshot = snapshot,
                    actionItem = request.mediaItem,
                    onMutation = onMutation,
                    onDismiss = controller::closeEpisodes,
                    onSelect = { controller.selectEpisode(it.id) },
                    onPlayQueuedItem = { queued ->
                        controller.closeEpisodes()
                        controller.playQueueItem(queued)
                    },
                    fullscreen = false,
                )
            }
            if (fullScreen && session.queueOpen) {
                PlaybackQueueDrawer(
                    items = snapshot?.queue.orEmpty(),
                    onClose = controller::closeQueue,
                    onPlay = controller::playQueueItem,
                    onChange = { items -> onMutation(ProfileMutation.SetQueue(items)) },
                )
            }
            if (fullScreen) {
                session.streamPicker?.let { picker ->
                    PlayerStreamDrawer(
                        episode = picker.episode,
                        streams = picker.streams,
                        addonChoices = picker.addonChoices,
                        selectedAddonId = picker.selectedAddonId,
                        resumeFrom = picker.resumeFrom,
                        loading = picker.loading,
                        error = picker.error,
                        onBack = controller::backToEpisodes,
                        onDismiss = controller::closeStreamPicker,
                        onSelectAddon = controller::selectStreamAddon,
                        onRetry = controller::retryStreams,
                        onSelect = controller::selectStream,
                    )
                }
            }
            // Queue notices render inside the player: the scaffold snackbar
            // host sits below this overlay stack during fullscreen playback.
            if (fullScreen) {
                PlayerQueueToast(modifier = Modifier.align(Alignment.TopCenter))
            }
        } else if (!systemPip) {
            val edgePaddingPx = with(density) { 12.dp.roundToPx() }
            val bottomPaddingPx = with(density) { miniBottomPadding.roundToPx() }
            val topPaddingPx = WindowInsets.statusBars.getTop(density) + edgePaddingPx
            val horizontalLimit = (containerSize.width - miniSize.width - edgePaddingPx * 2).coerceAtLeast(0)
            val verticalLimit = (
                containerSize.height - miniSize.height - bottomPaddingPx - topPaddingPx
            ).coerceAtLeast(0)
            val minimumWidthDp = if (expanded || isTablet) 240f else 180f
            val availableWidthDp = with(density) {
                (containerSize.width - 24.dp.roundToPx()).coerceAtLeast(1).toDp().value
            }
            val maximumWidthDp = (if (isTablet) {
                (availableWidthDp * .60f).coerceAtMost(720f)
            } else if (expanded) {
                480f
            } else {
                340f
            }).coerceAtMost(availableWidthDp).coerceAtLeast(minimumWidthDp)
            val currentHorizontalLimit by rememberUpdatedState(horizontalLimit)
            val currentVerticalLimit by rememberUpdatedState(verticalLimit)
            val currentMinimumWidthDp by rememberUpdatedState(minimumWidthDp)
            val currentMaximumWidthDp by rememberUpdatedState(maximumWidthDp)
            val minimumFlingSpeedPx = with(density) { 50.dp.toPx() }
            val currentMinimumFlingSpeedPx by rememberUpdatedState(minimumFlingSpeedPx)
            LaunchedEffect(horizontalLimit, verticalLimit, miniGestureActive) {
                miniOffset = if (miniGestureActive) {
                    IntOffset(
                        miniOffset.x.coerceIn(-horizontalLimit, 0),
                        miniOffset.y.coerceIn(-verticalLimit, 0),
                    )
                } else {
                    IntOffset(
                        x = if (miniDockedLeft) -horizontalLimit else 0,
                        y = if (miniDockedTop) -verticalLimit else 0,
                    )
                }
            }
            Box(
                miniLayout
                    .clip(RoundedCornerShape(10.dp))
                    .onSizeChanged { miniSize = it }
                    .pointerInput(request.identity, containerSize) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            val velocityTracker = VelocityTracker()
                            var trackedDrag = Offset.Zero
                            var resizedDuringGesture = false
                            velocityTracker.addPosition(down.uptimeMillis, trackedDrag)
                            miniGestureActive = true
                            do {
                                val event = awaitPointerEvent()
                                val pan = event.calculatePan()
                                val zoom = event.calculateZoom()
                                if (event.changes.count { it.pressed } > 1) {
                                    resizedDuringGesture = true
                                }
                                miniWidthDp = (miniWidthDp * zoom).coerceIn(
                                    currentMinimumWidthDp,
                                    currentMaximumWidthDp,
                                )
                                miniOffset = IntOffset(
                                    x = (miniOffset.x + pan.x.roundToInt())
                                        .coerceIn(-currentHorizontalLimit, 0),
                                    y = (miniOffset.y + pan.y.roundToInt())
                                        .coerceIn(-currentVerticalLimit, 0),
                                )
                                trackedDrag += pan
                                val eventTime = event.changes.maxOfOrNull { it.uptimeMillis }
                                    ?: down.uptimeMillis
                                velocityTracker.addPosition(eventTime, trackedDrag)
                                event.changes.forEach { change ->
                                    if (change.positionChanged()) change.consume()
                                }
                            } while (event.changes.any { it.pressed })
                            val velocity = velocityTracker.calculateVelocity()
                            val speed = sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
                            if (!resizedDuringGesture && speed >= currentMinimumFlingSpeedPx) {
                                val projectedX = miniOffset.x + velocity.x * .25f
                                val projectedY = miniOffset.y + velocity.y * .25f
                                val horizontalDominant = abs(velocity.x) > abs(velocity.y) * 1.35f
                                val verticalDominant = abs(velocity.y) > abs(velocity.x) * 1.35f
                                if (!verticalDominant) {
                                    miniDockedLeft = projectedX < -currentHorizontalLimit / 2f
                                }
                                if (!horizontalDominant) {
                                    miniDockedTop = projectedY < -currentVerticalLimit / 2f
                                }
                            }
                            miniGestureActive = false
                            miniOffset = IntOffset(
                                x = if (miniDockedLeft) -currentHorizontalLimit else 0,
                                y = if (miniDockedTop) -currentVerticalLimit else 0,
                            )
                        }
                    }
                    .clickable(onClick = controller::restore),
            ) {
                IconButton(
                    onClick = {
                        controller.send(
                            if (session.playback.playing) PlaybackCommand.Pause else PlaybackCommand.Play,
                        )
                    },
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(2.dp)
                        .background(Color.Black.copy(alpha = .68f), androidx.compose.foundation.shape.CircleShape),
                ) {
                    Icon(
                        if (session.playback.playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        if (session.playback.playing) "Pause" else "Play",
                        tint = Color.White,
                    )
                }
                IconButton(
                    onClick = controller::close,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(2.dp)
                        .background(Color.Black.copy(alpha = .68f), androidx.compose.foundation.shape.CircleShape),
                ) {
                    Icon(Icons.Rounded.Close, "Close player", tint = Color.White)
                }
                LinearProgressIndicator(
                    progress = {
                        if (session.playback.durationMs > 0) {
                            (session.playback.positionMs.toFloat() / session.playback.durationMs.toFloat())
                                .coerceIn(0f, 1f)
                        } else {
                            0f
                        }
                    },
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = Color.White.copy(alpha = .28f),
                    drawStopIndicator = {},
                )
            }
        }
    }
}

@Composable
private fun BoxScope.PlaybackQueueDrawer(
    items: List<PlaybackQueueItem>,
    onClose: () -> Unit,
    onPlay: (PlaybackQueueItem) -> Unit,
    onChange: suspend (List<PlaybackQueueItem>) -> Result<Unit>,
) {
    val scope = rememberCoroutineScope()
    var confirmClear by remember { mutableStateOf(false) }

    Box(Modifier.matchParentSize().background(Color.Black.copy(.32f))) {
        Box(Modifier.matchParentSize().clickable(onClick = onClose))
        Surface(
            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(.68f),
            color = Color(0xF21A1A1D),
            shape = RoundedCornerShape(topStart = 28.dp, bottomStart = 28.dp),
            shadowElevation = 20.dp,
        ) {
            Column(Modifier.statusBarsPadding().navigationBarsPadding().padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Queue", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    if (items.isNotEmpty()) {
                        Text("  ·  ${items.size}", color = Color.White.copy(.55f), style = MaterialTheme.typography.titleMedium)
                    }
                    Spacer(Modifier.weight(1f))
                    if (items.isNotEmpty()) {
                        TextButton(onClick = { confirmClear = true }) { Text("Clear") }
                    }
                    IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close queue", tint = Color.White) }
                }
                if (items.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Rounded.QueueMusic, null, tint = Color.White.copy(.45f), modifier = Modifier.size(34.dp))
                            Text("Your queue is empty", color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text("Add movies or episodes from their menus.", color = Color.White.copy(.58f), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                } else {
                    QueueList(
                        items = items,
                        compact = false,
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentPadding = PaddingValues(top = 10.dp),
                        onPlay = onPlay,
                        onCommit = { changed -> onChange(changed) },
                    )
                }
            }
        }
    }
    ClearQueueDialog(
        visible = confirmClear,
        onConfirm = {
            confirmClear = false
            QueueToasts.emit("Queue cleared")
            scope.launch { onChange(emptyList()) }
        },
        onDismiss = { confirmClear = false },
    )
}

/**
 * Queue feedback pill for fullscreen playback. Collected from the shared bus
 * here because the scaffold snackbar renders underneath the player overlay.
 */
@Composable
private fun BoxScope.PlayerQueueToast(modifier: Modifier = Modifier) {
    var message by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        QueueToasts.notices.collect { notice ->
            message = notice
            visible = true
        }
    }
    LaunchedEffect(visible) {
        if (visible) {
            kotlinx.coroutines.delay(2_200)
            visible = false
        }
    }
    androidx.compose.animation.AnimatedVisibility(
        visible = visible,
        enter = androidx.compose.animation.fadeIn() + androidx.compose.animation.slideInVertically { -it },
        exit = androidx.compose.animation.fadeOut(),
        modifier = modifier
            .statusBarsPadding()
            .padding(top = 64.dp),
    ) {
        Surface(
            color = Color.Black.copy(alpha = .82f),
            contentColor = Color.White,
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, Color.White.copy(alpha = .14f)),
        ) {
            Text(
                message,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun PlayerBackButton(onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(48.dp)
            .background(Color.Black.copy(.55f), androidx.compose.foundation.shape.CircleShape),
    ) {
        Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White)
    }
}

@Composable
private fun PipHandoffIndicator(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.padding(bottom = 104.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Icon(
                Icons.Rounded.PictureInPictureAlt,
                contentDescription = null,
                tint = Color.White.copy(alpha = .48f),
                modifier = Modifier.size(168.dp),
            )
            Text(
                "This video is playing in picture in picture.",
                color = Color.White.copy(alpha = .58f),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainTopBar(
    profiles: List<ProfileSummary>,
    activeProfile: ProfileSummary?,
    query: String,
    onQueryChange: (String) -> Unit,
    requestSearchFocus: Boolean,
    onSearchFocusConsumed: () -> Unit,
    onSelectProfile: (String) -> Unit,
    onOpenHome: () -> Unit,
    onAddProfile: () -> Unit,
    onOpenAddons: () -> Unit,
    onOpenSettings: () -> Unit,
    queueSize: Int,
    onOpenQueue: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val searchFocus = remember { FocusRequester() }
    var profileMenuOpen by remember { mutableStateOf(false) }
    var showAllProfiles by remember { mutableStateOf(false) }
    val compactProfiles = remember(profiles, activeProfile?.id) {
        listOfNotNull(activeProfile) + profiles.filter { it.id != activeProfile?.id }.take(3)
    }
    val visibleProfiles = if (showAllProfiles) profiles else compactProfiles
    val hiddenProfiles = (profiles.size - compactProfiles.size).coerceAtLeast(0)
    LaunchedEffect(requestSearchFocus) {
        if (requestSearchFocus) {
            searchFocus.requestFocus()
            onSearchFocusConsumed()
        }
    }
    // Keep the top controls subtly glassy, but stable while scrolling.
    val controlColor = Color(0xE817171A)
    val searchFocusedColor = Color.Black.copy(alpha = .88f)
    val searchUnfocusedColor = Color.Black.copy(alpha = .82f)
    Row(
        modifier.statusBarsPadding().fillMaxWidth().padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
            Surface(
                onClick = onOpenHome,
                color = controlColor,
                contentColor = Color.White,
                shape = RoundedCornerShape(17.dp),
                border = BorderStroke(1.dp, Color.White.copy(alpha = .14f)),
                shadowElevation = 10.dp,
                modifier = Modifier.size(52.dp),
            ) {
                Box(Modifier.padding(8.dp), contentAlignment = Alignment.Center) {
                    ConduitMark(Modifier.fillMaxSize())
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.weight(1f).height(52.dp).focusRequester(searchFocus),
                placeholder = { Text("Search Conduit", maxLines = 1) },
                leadingIcon = { Icon(Icons.Rounded.Search, null, Modifier.size(20.dp)) },
                trailingIcon = if (query.isNotBlank()) {{
                    IconButton(onClick = { onQueryChange("") }) { Icon(Icons.Rounded.Close, "Clear") }
                }} else null,
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = searchFocusedColor,
                    unfocusedContainerColor = searchUnfocusedColor,
                    focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = .7f),
                    unfocusedBorderColor = Color.White.copy(alpha = .1f),
                ),
            )
            Box {
                Surface(
                    onClick = { profileMenuOpen = true },
                    modifier = Modifier.size(52.dp),
                    shape = RoundedCornerShape(17.dp),
                    color = controlColor,
                    contentColor = Color.White,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = .14f)),
                    shadowElevation = 10.dp,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Surface(
                            modifier = Modifier.size(38.dp),
                            shape = androidx.compose.foundation.shape.CircleShape,
                            color = activeProfile?.avatarColor?.let(::topProfileColor) ?: MaterialTheme.colorScheme.primary,
                            border = BorderStroke(2.dp, Color.White.copy(alpha = .18f)),
                        ) {
                            if (!activeProfile?.avatarUrl.isNullOrBlank()) {
                                AsyncImage(activeProfile.avatarUrl, activeProfile.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            } else Box(contentAlignment = Alignment.Center) {
                                Text(activeProfile?.name?.take(1)?.uppercase() ?: "P", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                DropdownMenu(
                    expanded = profileMenuOpen,
                    onDismissRequest = { profileMenuOpen = false },
                    modifier = Modifier
                        .width(300.dp)
                        .heightIn(max = 480.dp)
                        .border(BorderStroke(1.dp, Color.White.copy(alpha = .13f)), RoundedCornerShape(24.dp)),
                    shape = RoundedCornerShape(24.dp),
                    containerColor = Color(0xF018181B),
                    tonalElevation = 0.dp,
                    shadowElevation = 24.dp,
                ) {
                    Text(
                        "Switch profile",
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                        style = MaterialTheme.typography.titleSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                    visibleProfiles.forEach { profile ->
                        DropdownMenuItem(
                            modifier = Modifier
                                .clip(RoundedCornerShape(16.dp))
                                .background(
                                    if (profile.id == activeProfile?.id) Color(0x1FFBBF24) else Color.Transparent,
                                    RoundedCornerShape(16.dp),
                                ),
                            text = {
                                Column {
                                    Text(profile.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (profile.isKids) Text("Kids profile", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            },
                            leadingIcon = {
                                Surface(
                                    modifier = Modifier.size(32.dp),
                                    shape = androidx.compose.foundation.shape.CircleShape,
                                    color = profile.avatarColor?.let(::topProfileColor) ?: MaterialTheme.colorScheme.primary,
                                ) {
                                    if (!profile.avatarUrl.isNullOrBlank()) {
                                        AsyncImage(profile.avatarUrl, profile.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                    } else Box(contentAlignment = Alignment.Center) { Text(profile.name.take(1).uppercase(), fontWeight = FontWeight.Bold) }
                                }
                            },
                            trailingIcon = if (profile.id == activeProfile?.id) {{ Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) }} else null,
                            onClick = { profileMenuOpen = false; onSelectProfile(profile.id) },
                        )
                    }
                    if (hiddenProfiles > 0) {
                        DropdownMenuItem(
                            modifier = Modifier.clip(RoundedCornerShape(16.dp)),
                            text = { Text(if (showAllProfiles) "Show fewer profiles" else "Show $hiddenProfiles more") },
                            leadingIcon = { Icon(Icons.Rounded.KeyboardArrowDown, null) },
                            onClick = { showAllProfiles = !showAllProfiles },
                        )
                    }
                    HorizontalDivider()
                    if (queueSize > 0) {
                        DropdownMenuItem(
                            modifier = Modifier.clip(RoundedCornerShape(16.dp)),
                            text = { Text("Queue") },
                            leadingIcon = { Icon(Icons.Rounded.QueueMusic, null) },
                            trailingIcon = { Text(queueSize.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant) },
                            onClick = { profileMenuOpen = false; onOpenQueue() },
                        )
                    }
                    DropdownMenuItem(
                        modifier = Modifier.clip(RoundedCornerShape(16.dp)),
                        text = { Text("Add profile") },
                        leadingIcon = { Icon(Icons.Rounded.Add, null) },
                        onClick = { profileMenuOpen = false; onAddProfile() },
                    )
                    DropdownMenuItem(
                        modifier = Modifier.clip(RoundedCornerShape(16.dp)),
                        text = { Text("Add-ons") },
                        leadingIcon = { Icon(Icons.Rounded.Extension, null) },
                        onClick = { profileMenuOpen = false; onOpenAddons() },
                    )
                    DropdownMenuItem(
                        modifier = Modifier.clip(RoundedCornerShape(16.dp)),
                        text = { Text("Settings") },
                        leadingIcon = { Icon(Icons.Rounded.Settings, null) },
                        onClick = { profileMenuOpen = false; onOpenSettings() },
                    )
                    DropdownMenuItem(
                        modifier = Modifier.clip(RoundedCornerShape(16.dp)),
                        text = { Text("Log out", color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.AutoMirrored.Rounded.Logout, null, tint = MaterialTheme.colorScheme.error) },
                        onClick = { profileMenuOpen = false; onSignOut() },
                    )
                }
            }
    }
}

private fun topProfileColor(hex: String): Color = runCatching {
    Color((0xFF000000L or hex.removePrefix("#").toLong(16)).toInt())
}.getOrDefault(Color(0xFFFBBF24))

@Composable
private fun ConduitDesktopRail(
    selected: AppDestination,
    onSelect: (AppDestination) -> Unit,
) {
    val destinations = AppDestination.entries.filter(AppDestination::showInNavigation)
    val main = destinations.filterNot { it == AppDestination.Profile }
    val effectiveSelection = if (selected == AppDestination.Calendar) AppDestination.Library else selected

    Box(Modifier.width(72.dp).fillMaxHeight().background(Color.Black)) {
        Column(
            Modifier.fillMaxHeight().width(72.dp).padding(vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ConduitMark(Modifier.size(34.dp))
            Spacer(Modifier.height(22.dp))
            main.forEach { destination ->
                DesktopRailItem(
                    destination = destination,
                    selected = destination == effectiveSelection,
                    onClick = { onSelect(destination) },
                )
                Spacer(Modifier.height(4.dp))
            }
            Spacer(Modifier.weight(1f))
            DesktopRailItem(
                destination = AppDestination.Profile,
                selected = effectiveSelection == AppDestination.Profile,
                onClick = { onSelect(AppDestination.Profile) },
            )
        }
        VerticalDivider(
            Modifier.fillMaxHeight().align(Alignment.CenterEnd),
            color = MaterialTheme.colorScheme.outline.copy(alpha = .45f),
        )
    }
}

@Composable
private fun DesktopRailItem(
    destination: AppDestination,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val contentColor = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        Modifier.size(52.dp).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Box(
                Modifier.align(Alignment.CenterStart)
                    .width(3.dp)
                    .height(26.dp)
                    .background(MaterialTheme.colorScheme.primary),
            )
        }
        Icon(destination.icon, destination.label, tint = contentColor, modifier = Modifier.size(24.dp))
    }
}

private val AppDestination.icon: ImageVector
    get() = when (this) {
        AppDestination.Home -> Icons.Rounded.Home
        AppDestination.Search -> Icons.Rounded.Explore
        AppDestination.Library -> Icons.Rounded.VideoLibrary
        AppDestination.Calendar -> Icons.Rounded.CalendarMonth
        AppDestination.Profile -> Icons.Rounded.Settings
        AppDestination.ContinueWatching -> Icons.Rounded.History
    }

@Composable
internal fun RowScope.MobileNavigationItem(
    destination: AppDestination,
    selected: Boolean,
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
        Icon(destination.icon, destination.label, tint = color, modifier = Modifier.size(24.dp))
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
                " · ${playback.engine.name.lowercase()}" +
                if (playback.playing) " · playing" else " · paused",
        )
        playback.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        OutlinedButton(onClick = {
            playerOpen = false
            activeRequestId?.let { engineState = client.dispatch(EngineAction.Cancel(requestId = it)) }
        }) { Text("Close player") }
    }
}
