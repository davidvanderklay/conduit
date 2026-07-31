package media.conduit.mobile.account

import media.conduit.mobile.foundation.ServerEndpoint
import io.ktor.http.Url

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
    suspend fun startOAuth(endpoint: ServerEndpoint, pkce: PkcePair): PendingOAuth {
        val started = api.startMobileAuth(endpoint.baseUrl, pkce.challenge)
        return PendingOAuth(
            serverBaseUrl = endpoint.baseUrl,
            requestId = started.requestId,
            verifier = pkce.verifier,
            authorizationUrl = started.authorizationUrl,
            expiresAt = started.expiresAt,
        ).also(vault::savePendingOAuth)
    }

    suspend fun completeOAuth(endpoint: ServerEndpoint, callbackUrl: String): AccountStatus {
        val pending = vault.pendingOAuth(endpoint.baseUrl)
            ?: return AccountStatus.Error("This OAuth callback has no matching sign-in request")
        return try {
            val callback = Url(callbackUrl)
            val error = callback.parameters["error"]
            if (error != null) throw ServerRequestException("OAuth sign-in failed: $error")
            val requestId = callback.parameters["request"]
            val code = callback.parameters["code"]
            if (requestId != pending.requestId || code.isNullOrBlank()) {
                throw ServerRequestException("The OAuth callback did not match this device")
            }
            val exchanged = api.exchangeMobileAuth(
                endpoint.baseUrl,
                pending.requestId,
                code,
                pending.verifier,
            )
            val session = StoredSession(endpoint.baseUrl, exchanged.token, exchanged.expiresAt)
            vault.save(session)
            vault.clearPendingOAuth()
            AccountStatus.SignedIn(session, api.bootstrap(endpoint.baseUrl, session.token))
        } catch (cause: Exception) {
            vault.clearPendingOAuth()
            AccountStatus.Error(cause.message ?: "Unable to complete OAuth sign-in")
        }
    }

    suspend fun restore(endpoint: ServerEndpoint): AccountStatus {
        val authentication = try {
            api.validate(endpoint.baseUrl).authentication
        } catch (cause: Exception) {
            return AccountStatus.Error(cause.message ?: "Unable to reach this server")
        }
        val session = vault.loadFor(endpoint.baseUrl) ?: return AccountStatus.SignedOut(authentication)
        return try {
            AccountStatus.SignedIn(session, api.bootstrap(endpoint.baseUrl, session.token))
        } catch (cause: Exception) {
            if ((cause as? ServerRequestException)?.statusCode == 401) {
                vault.clear()
                AccountStatus.SignedOut(authentication, "Your session expired. Sign in again.")
            } else {
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
        val authenticated = api.signIn(endpoint.baseUrl, email, password)
        val session = StoredSession(endpoint.baseUrl, authenticated.token)
        val bootstrap = api.bootstrap(endpoint.baseUrl, session.token)
        vault.save(session)
        AccountStatus.SignedIn(session, bootstrap)
    } catch (cause: Exception) {
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
        val authenticated = api.register(endpoint.baseUrl, email, password)
        val session = StoredSession(endpoint.baseUrl, authenticated.token)
        val bootstrap = api.bootstrap(endpoint.baseUrl, session.token)
        vault.save(session)
        val signedIn = AccountStatus.SignedIn(session, bootstrap)
        runCatching { api.generateRecoveryCodes(endpoint.baseUrl, session.token) }
            .getOrNull()
            ?.let { AccountStatus.RecoveryCodes(it, signedIn) }
            ?: signedIn
    } catch (cause: Exception) {
        AccountStatus.SignedOut(
            authentication,
            cause.message ?: "Unable to create the account",
        )
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
