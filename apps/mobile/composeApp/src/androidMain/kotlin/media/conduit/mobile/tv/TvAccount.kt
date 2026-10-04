package media.conduit.mobile.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import media.conduit.mobile.PlatformBackHandler
import media.conduit.mobile.TvSignInModel
import media.conduit.mobile.account.TvPairing
import kotlinx.coroutines.delay
import media.conduit.mobile.foundation.AppAction
import media.conduit.mobile.foundation.AppState
import media.conduit.mobile.foundation.ConduitMark
import media.conduit.mobile.foundation.DefaultServerEndpoint

/** Brand on the left, a narrow form on the right: the frame for every signed-out TV screen. */
@Composable
private fun TvAccountFrame(
    title: String,
    detail: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Row(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(horizontal = 64.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(56.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ConduitMark(Modifier.size(44.dp))
                Text("conduit", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            Text(title, color = Color.White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold)
            Text(detail, color = TvColors.Muted, style = MaterialTheme.typography.bodyLarge)
        }
        Column(
            Modifier.width(380.dp).imePadding().verticalScroll(rememberScrollState()).padding(vertical = TvSpacing.Edge),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
private fun TvFormError(message: String?) {
    message?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
}

@Composable
internal fun TvServerSetup(state: AppState, dispatch: (AppAction) -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocus() }
    TvAccountFrame("Connect to your server", "Use HTTPS for hosted or self-hosted instances.") {
        TvTextField(
            value = state.setupInput,
            onValueChange = { dispatch(AppAction.SetupInputChanged(it)) },
            label = "Server URL",
            placeholder = "https://conduit.example",
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Done,
            onImeAction = { dispatch(AppAction.ConnectRequested) },
            modifier = Modifier.fillMaxWidth().focusRequester(first),
        )
        TvFormError(state.setupError)
        TvButton(
            if (state.pendingEndpoint != null) "Checking server…" else "Continue",
            onClick = { dispatch(AppAction.ConnectRequested) },
            primary = true,
            enabled = state.pendingEndpoint == null,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun TvSignIn(model: TvSignInModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var recoveryCode by remember { mutableStateOf("") }
    var pending by remember(model.error) { mutableStateOf(false) }
    var registering by remember(model.authentication.needsOwner) { mutableStateOf(model.authentication.needsOwner) }
    var recovering by remember { mutableStateOf(false) }
    var choosingServer by remember(model.endpoint.baseUrl) { mutableStateOf(false) }
    var pairing by remember(model.endpoint.baseUrl) { mutableStateOf(false) }
    if (pairing) {
        TvPhoneSignIn(model, onCancel = { pairing = false })
        return
    }
    val first = remember { FocusRequester() }
    LaunchedEffect(choosingServer) { first.requestFocus() }

    if (choosingServer) {
        var customServer by remember {
            mutableStateOf(if (model.endpoint == DefaultServerEndpoint) "" else model.endpoint.baseUrl)
        }
        PlatformBackHandler(enabled = !model.serverPending, onBack = { choosingServer = false })
        TvAccountFrame("Choose your server", "Your choice stays on this device.") {
            TvButton(
                "Default server",
                onClick = { model.onConnectServer(DefaultServerEndpoint.baseUrl) },
                enabled = !model.serverPending,
                modifier = Modifier.fillMaxWidth().focusRequester(first),
            )
            TvTextField(
                value = customServer,
                onValueChange = { customServer = it },
                label = "Self-hosted server",
                placeholder = "https://conduit.example.com",
                keyboardType = KeyboardType.Uri,
                imeAction = ImeAction.Done,
                onImeAction = { if (customServer.isNotBlank()) model.onConnectServer(customServer) },
                modifier = Modifier.fillMaxWidth(),
            )
            TvFormError(model.serverError)
            TvButton(
                if (model.serverPending) "Checking…" else "Connect",
                onClick = { model.onConnectServer(customServer) },
                primary = true,
                enabled = !model.serverPending && customServer.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            )
            TvButton("Cancel", onClick = { choosingServer = false }, enabled = !model.serverPending, modifier = Modifier.fillMaxWidth())
        }
        return
    }

    val title = when {
        recovering -> "Recover your account"
        registering -> if (model.authentication.needsOwner) "Set up conduit" else "Create your account"
        else -> "Welcome back"
    }
    val detail = when {
        recovering -> "Enter one of the recovery codes you saved."
        registering -> "Create a private account for this conduit instance."
        else -> "Sign in to continue to your household."
    }
    val canSubmit = model.authenticationReady && !pending && email.isNotBlank() && password.length >= 8 &&
        (!recovering || recoveryCode.isNotBlank())
    val submit = {
        if (canSubmit) {
            pending = true
            when {
                recovering -> model.onRecover(email, recoveryCode, password)
                registering -> model.onRegister(email, password)
                else -> model.onSignIn(email, password)
            }
        }
    }
    TvAccountFrame(title, detail) {
        if (model.authenticationLoading && !model.authenticationReady) {
            Text("Waking server…", color = TvColors.Muted, style = MaterialTheme.typography.bodySmall)
        }
        model.authenticationError?.let { message ->
            TvFormError(message)
            TvButton("Retry", onClick = model.onRetryAuthentication, modifier = Modifier.fillMaxWidth())
        }
        TvTextField(
            value = email,
            onValueChange = { email = it },
            label = "Email address",
            placeholder = "you@example.com",
            keyboardType = KeyboardType.Email,
            modifier = Modifier.fillMaxWidth().focusRequester(first),
        )
        if (recovering) {
            TvTextField(
                value = recoveryCode,
                onValueChange = { recoveryCode = it },
                label = "Recovery code",
                placeholder = "XXXX-XXXX-XXXX-XXXX",
                modifier = Modifier.fillMaxWidth(),
            )
        }
        TvTextField(
            value = password,
            onValueChange = { password = it },
            label = if (recovering) "New password" else "Password",
            placeholder = if (registering || recovering) "At least 8 characters" else "",
            password = true,
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.Done,
            onImeAction = submit,
            modifier = Modifier.fillMaxWidth(),
        )
        TvFormError(model.error)
        TvButton(
            when {
                pending -> "Please wait…"
                recovering -> "Reset password"
                registering -> "Create account"
                else -> "Sign in"
            },
            onClick = submit,
            primary = true,
            enabled = canSubmit,
            modifier = Modifier.fillMaxWidth(),
        )
        if (recovering) {
            TvButton("Back to sign in", onClick = { recovering = false; password = "" }, modifier = Modifier.fillMaxWidth())
        } else {
            if (model.authenticationReady && !registering) {
                TvButton("Use recovery code", onClick = { recovering = true; password = "" }, modifier = Modifier.fillMaxWidth())
            }
            if (model.authentication.localRegistration) {
                TvButton(
                    if (registering) "Sign in instead" else "Create a local account",
                    onClick = { registering = !registering },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (model.authenticationReady && !recovering && !registering) {
            TvButton(
                model.authentication.oidc.takeIf { it.enabled }?.let { "${it.displayName ?: "Continue with Google"} on your phone" }
                    ?: "Sign in with your phone",
                onClick = { pairing = true },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        TvButton(
            "Server: ${if (model.endpoint == DefaultServerEndpoint) "Default" else model.endpoint.label}",
            onClick = { choosingServer = true },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun TvHouseholdSetup(onCreate: (String, String) -> Unit) {
    var household by remember { mutableStateOf("Home") }
    var profile by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocus() }
    val canCreate = !pending && household.isNotBlank() && profile.isNotBlank()
    val create = {
        if (canCreate) {
            pending = true
            onCreate(household, profile)
        }
    }
    TvAccountFrame("Create your household", "Profiles, add-ons, and watch state synchronize through your conduit server.") {
        TvTextField(household, { household = it }, "Household name", Modifier.fillMaxWidth().focusRequester(first))
        TvTextField(
            profile, { profile = it }, "Your profile name", Modifier.fillMaxWidth(),
            imeAction = ImeAction.Done, onImeAction = create,
        )
        TvButton(if (pending) "Creating…" else "Create household", onClick = create, primary = true, enabled = canCreate, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
internal fun TvRecoveryCodes(codes: List<String>, onSaved: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocus() }
    TvAccountFrame("Save your recovery codes", "Each code works once. Write them down or photograph this screen before continuing.") {
        codes.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                pair.forEach { code ->
                    Text(code, color = Color.White, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                }
            }
        }
        Box(Modifier.padding(top = 8.dp)) {
            TvButton("I saved these codes", onClick = onSaved, primary = true, modifier = Modifier.fillMaxWidth().focusRequester(first))
        }
    }
}

@Composable
internal fun TvConnectionError(message: String, onRetry: () -> Unit, onChangeServer: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocus() }
    TvAccountFrame("Server unavailable", message) {
        TvButton("Retry", onClick = onRetry, primary = true, modifier = Modifier.fillMaxWidth().focusRequester(first))
        TvButton("Use another server", onClick = onChangeServer, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * Sign-in without typing: the TV shows a code, a phone opens it, signs in
 * there, and approves. The code carries only a request id.
 */
@Composable
private fun TvPhoneSignIn(model: TvSignInModel, onCancel: () -> Unit) {
    var attempt by remember { mutableStateOf(0) }
    var pairing by remember { mutableStateOf<TvPairing?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val action = remember { FocusRequester() }
    PlatformBackHandler(onBack = onCancel)
    LaunchedEffect(attempt) {
        pairing = null
        error = null
        val started = runCatching { model.onStartPairing() }.getOrElse {
            error = it.message ?: "Unable to start phone sign-in"
            return@LaunchedEffect
        }
        pairing = started
        // Poll until approved; the server rejects the request once it expires.
        while (true) {
            delay(2_500)
            val approved = runCatching { model.onPollPairing(started) }.getOrElse {
                pairing = null
                error = "This code expired."
                return@LaunchedEffect
            }
            if (approved) return@LaunchedEffect
        }
    }
    LaunchedEffect(pairing == null) { action.requestFocusWhenReady() }
    TvAccountFrame("Sign in with your phone", "Scan the code with your phone camera, sign in there, and approve this TV.") {
        val current = pairing
        if (current != null) {
            TvQrCode(current.request.verificationUrl, Modifier.size(220.dp))
            Text("Confirm this code on your phone", color = TvColors.Muted, style = MaterialTheme.typography.bodyMedium)
            Text(current.request.userCode, color = TvColors.Amber, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            TvButton("Cancel", onClick = onCancel, modifier = Modifier.fillMaxWidth().focusRequester(action))
        } else {
            Text(error ?: "Preparing a code…", color = if (error != null) MaterialTheme.colorScheme.error else TvColors.Muted)
            if (error != null) {
                TvButton("New code", onClick = { attempt++ }, primary = true, modifier = Modifier.fillMaxWidth().focusRequester(action))
                TvButton("Back", onClick = onCancel, modifier = Modifier.fillMaxWidth())
            } else {
                TvButton("Cancel", onClick = onCancel, modifier = Modifier.fillMaxWidth().focusRequester(action))
            }
        }
    }
}
