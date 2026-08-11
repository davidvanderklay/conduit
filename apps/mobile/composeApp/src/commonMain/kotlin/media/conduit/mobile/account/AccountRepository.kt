package media.conduit.mobile.account

import media.conduit.mobile.foundation.ServerEndpoint
import io.ktor.http.Url
import kotlinx.coroutines.CancellationException

sealed interface AccountStatus {
    data object Loading : AccountStatus
    data class SignedOut(
        val authentication: AuthenticationConfiguration,
        val error: String? = null,
    ) : AccountStatus
    data class SignedIn(
        val session: StoredSession,
        val bootstrap: BootstrapResponse,
    ) : AccountStatus
    data class RecoveryCodes(
        val codes: List<String>,
        val signedIn: SignedIn,
    ) : AccountStatus
    data class Error(val message: String) : AccountStatus
}

class AccountRepository(
    private val api: ConduitApi,
    private val vault: SessionVault,
) {
    fun hasStoredSession(serverBaseUrl: String): Boolean = vault.loadFor(serverBaseUrl) != null

    suspend fun discoverAuthentication(endpoint: ServerEndpoint): AuthenticationConfiguration =
        LifecycleDiagnostics.timed("auth.discovery") {
            api.validate(endpoint.baseUrl).authentication
        }

    suspend fun startOAuth(endpoint: ServerEndpoint, pkce: PkcePair): PendingOAuth {
        LifecycleDiagnostics.event("oauth.start")
        val started = LifecycleDiagnostics.timed("oauth.start.request") {
            api.startMobileAuth(endpoint.baseUrl, pkce.challenge)
        }
        return PendingOAuth(
            serverBaseUrl = endpoint.baseUrl,
            requestId = started.requestId,
            verifier = pkce.verifier,
            authorizationUrl = started.authorizationUrl,
            expiresAt = started.expiresAt,
        ).also {
            vault.savePendingOAuth(it)
            LifecycleDiagnostics.event("oauth.pending.saved")
        }
    }

    fun hasPendingOAuth(serverBaseUrl: String): Boolean = vault.pendingOAuth(serverBaseUrl) != null

    fun pendingOAuth(serverBaseUrl: String): PendingOAuth? = vault.pendingOAuth(serverBaseUrl)

    suspend fun completeOAuth(endpoint: ServerEndpoint, callbackUrl: String): AccountStatus {
        LifecycleDiagnostics.event("oauth.callback.received")
        val pending = vault.pendingOAuth(endpoint.baseUrl)
            ?: return AccountStatus.Error("This OAuth callback has no matching sign-in request")
        val callback = runCatching { Url(callbackUrl) }.getOrElse {
            vault.clearPendingOAuth()
            return AccountStatus.Error("The OAuth callback was malformed")
        }
        val error = callback.parameters["error"]
        if (error != null) {
            vault.clearPendingOAuth()
            LifecycleDiagnostics.event("oauth.callback.rejected", "reason=provider-error")
            return AccountStatus.Error("OAuth sign-in failed: $error")
        }
        val requestId = callback.parameters["request"]
        val code = callback.parameters["code"]
        if (requestId != pending.requestId || code.isNullOrBlank()) {
            vault.clearPendingOAuth()
            LifecycleDiagnostics.event("oauth.callback.rejected", "reason=unmatched")
            return AccountStatus.Error("The OAuth callback did not match this device")
        }
        return try {
            val exchanged = LifecycleDiagnostics.timed("oauth.exchange") {
                api.exchangeMobileAuth(
                    endpoint.baseUrl,
                    pending.requestId,
                    code,
                    pending.verifier,
                )
            }
            val session = StoredSession(endpoint.baseUrl, exchanged.token, exchanged.expiresAt)
            vault.save(session)
            vault.clearPendingOAuth()
            LifecycleDiagnostics.event("oauth.session.saved")
            AccountStatus.SignedIn(session, LifecycleDiagnostics.timed("oauth.bootstrap") {
                api.bootstrap(endpoint.baseUrl, session.token)
            })
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            val retryable = keepOAuthPending(cause)
            if (!retryable) vault.clearPendingOAuth()
            LifecycleDiagnostics.event(
                "oauth.callback.failed",
                "retryable=$retryable",
            )
            AccountStatus.Error(cause.message ?: "Unable to complete OAuth sign-in")
        }
    }

    suspend fun restore(endpoint: ServerEndpoint): AccountStatus {
        LifecycleDiagnostics.event("auth.restore.start")
        val authentication = try {
            LifecycleDiagnostics.timed("auth.restore.validate") {
                discoverAuthentication(endpoint)
            }
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            LifecycleDiagnostics.event("auth.restore.failed", "phase=validate")
            return AccountStatus.Error(cause.message ?: "Unable to reach this server")
        }
        val session = vault.loadFor(endpoint.baseUrl)
        if (session == null) {
            LifecycleDiagnostics.event("auth.restore.signed-out", "session=absent")
            return AccountStatus.SignedOut(authentication)
        }
        return try {
            val bootstrap = LifecycleDiagnostics.timed("auth.restore.bootstrap") {
                api.bootstrap(endpoint.baseUrl, session.token)
            }
            LifecycleDiagnostics.event("auth.restore.signed-in")
            AccountStatus.SignedIn(session, bootstrap)
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            if ((cause as? ServerRequestException)?.statusCode == 401) {
                vault.clear()
                LifecycleDiagnostics.event("auth.restore.expired", "status=401")
                AccountStatus.SignedOut(authentication, "Your session expired. Sign in again.")
            } else {
                LifecycleDiagnostics.event("auth.restore.failed", "phase=bootstrap")
                AccountStatus.Error(cause.message ?: "Unable to synchronize your account")
            }
        }
    }

    suspend fun signIn(
        endpoint: ServerEndpoint,
        authentication: AuthenticationConfiguration,
        email: String,
        password: String,
    ): AccountStatus = try {
        LifecycleDiagnostics.event("auth.sign-in.start")
        val authenticated = api.signIn(endpoint.baseUrl, email, password)
        val session = StoredSession(endpoint.baseUrl, authenticated.token)
        val bootstrap = api.bootstrap(endpoint.baseUrl, session.token)
        vault.save(session)
        LifecycleDiagnostics.event("auth.sign-in.succeeded")
        AccountStatus.SignedIn(session, bootstrap)
    } catch (cause: Exception) {
        if (cause is CancellationException) throw cause
        LifecycleDiagnostics.event("auth.sign-in.failed")
        AccountStatus.SignedOut(
            authentication,
            cause.message ?: "Unable to sign in",
        )
    }

    suspend fun register(
        endpoint: ServerEndpoint,
        authentication: AuthenticationConfiguration,
        email: String,
        password: String,
    ): AccountStatus = try {
        LifecycleDiagnostics.event("auth.register.start")
        val authenticated = api.register(endpoint.baseUrl, email, password)
        val session = StoredSession(endpoint.baseUrl, authenticated.token)
        val bootstrap = api.bootstrap(endpoint.baseUrl, session.token)
        vault.save(session)
        LifecycleDiagnostics.event("auth.register.succeeded")
        val signedIn = AccountStatus.SignedIn(session, bootstrap)
        runCatching { api.generateRecoveryCodes(endpoint.baseUrl, session.token) }
            .getOrNull()
            ?.let { AccountStatus.RecoveryCodes(it, signedIn) }
            ?: signedIn
    } catch (cause: Exception) {
        if (cause is CancellationException) throw cause
        LifecycleDiagnostics.event("auth.register.failed")
        AccountStatus.SignedOut(
            authentication,
            cause.message ?: "Unable to create the account",
        )
    }

    private fun keepOAuthPending(cause: Throwable): Boolean {
        val status = (cause as? ServerRequestException)?.statusCode
        return status == null || status == 408 || status == 425 || status == 429 || status >= 500
    }

    suspend fun recover(endpoint: ServerEndpoint, authentication: AuthenticationConfiguration, email: String, code: String, password: String): AccountStatus = try {
        api.recoverAccount(endpoint.baseUrl, email, code, password)
        AccountStatus.SignedOut(authentication, "Password reset. You can sign in now.")
    } catch (cause: Exception) {
        AccountStatus.SignedOut(authentication, cause.message ?: "Recovery failed")
    }

    suspend fun signOut(endpoint: ServerEndpoint, session: StoredSession): AccountStatus {
        runCatching { api.signOut(endpoint.baseUrl, session.token) }
        vault.clear()
        return restore(endpoint)
    }

    suspend fun createHousehold(
        endpoint: ServerEndpoint,
        signedIn: AccountStatus.SignedIn,
        householdName: String,
        profileName: String,
    ): AccountStatus = try {
        api.createHousehold(
            endpoint.baseUrl,
            signedIn.session.token,
            householdName,
            profileName,
        )
        signedIn.copy(bootstrap = api.bootstrap(endpoint.baseUrl, signedIn.session.token))
    } catch (cause: Exception) {
        AccountStatus.Error(cause.message ?: "Unable to create your household")
    }
}
