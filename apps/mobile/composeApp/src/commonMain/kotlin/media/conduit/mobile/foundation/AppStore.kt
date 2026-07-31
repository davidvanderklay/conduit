package media.conduit.mobile.foundation

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.account.SessionVault

enum class AppDestination(val label: String) {
    Discover("Discover"),
    Library("Library"),
    Settings("Settings"),
}

data class AppState(
    val endpoint: ServerEndpoint? = null,
    val destination: AppDestination = AppDestination.Discover,
    val setupInput: String = "",
    val setupError: String? = null,
    val pendingEndpoint: ServerEndpoint? = null,
    val notice: String? = null,
)

sealed interface AppAction {
    data class SetupInputChanged(val value: String) : AppAction
    data object ConnectRequested : AppAction
    data class ConnectionSucceeded(val endpoint: ServerEndpoint) : AppAction
    data class ConnectionFailed(val message: String) : AppAction
    data object ForgetEndpoint : AppAction
    data class Navigate(val destination: AppDestination) : AppAction
    data object DismissNotice : AppAction
}

class AppStore(
    private val settings: SettingsStore,
    private val sessions: SessionVault? = null,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val endpointKey = "server.endpoint.v1"

    var state: AppState = loadState()
        private set

    fun dispatch(action: AppAction): AppState {
        state = when (action) {
            is AppAction.SetupInputChanged -> state.copy(setupInput = action.value, setupError = null)
            AppAction.ConnectRequested -> beginConnection()
            is AppAction.ConnectionSucceeded -> {
                if (action.endpoint == state.pendingEndpoint) saveEndpoint(action.endpoint) else state
            }
            is AppAction.ConnectionFailed -> state.copy(
                pendingEndpoint = null,
                setupError = action.message,
            )
            AppAction.ForgetEndpoint -> {
                sessions?.clear()
                settings.remove(endpointKey)
                AppState(notice = "Server connection removed")
            }
            is AppAction.Navigate -> state.copy(destination = action.destination)
            AppAction.DismissNotice -> state.copy(notice = null)
        }
        return state
    }

    private fun beginConnection(): AppState = when (val result = ServerEndpointValidator.validate(state.setupInput)) {
        is EndpointValidation.Invalid -> state.copy(setupError = result.message, pendingEndpoint = null)
        is EndpointValidation.Valid -> state.copy(setupError = null, pendingEndpoint = result.endpoint)
    }

    private fun saveEndpoint(endpoint: ServerEndpoint): AppState {
        settings.put(endpointKey, json.encodeToString(endpoint))
        return state.copy(
            endpoint = endpoint,
            pendingEndpoint = null,
            setupError = null,
            notice = "Server connection verified",
        )
    }

    private fun loadState(): AppState {
        val endpoint = settings.get(endpointKey)?.let { encoded ->
            runCatching { json.decodeFromString<ServerEndpoint>(encoded) }.getOrNull()
        }
        return AppState(endpoint = endpoint, setupInput = endpoint?.baseUrl.orEmpty())
    }
}
