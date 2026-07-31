package media.conduit.mobile.account

import media.conduit.mobile.foundation.ServerEndpoint

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
    data class Error(val message: String) : AccountStatus
}

class AccountRepository(
    private val api: ConduitApi,
    private val vault: SessionVault,
) {
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
        AccountStatus.SignedIn(session, bootstrap)
    } catch (cause: Exception) {
        AccountStatus.SignedOut(
            authentication,
            cause.message ?: "Unable to create the account",
        )
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
