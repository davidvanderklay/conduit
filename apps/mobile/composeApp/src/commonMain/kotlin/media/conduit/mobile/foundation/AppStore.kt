package media.conduit.mobile.foundation

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

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
    val notice: String? = null,
)

sealed interface AppAction {
    data class SetupInputChanged(val value: String) : AppAction
    data object SaveEndpoint : AppAction
    data object ForgetEndpoint : AppAction
    data class Navigate(val destination: AppDestination) : AppAction
    data object DismissNotice : AppAction
}

class AppStore(private val settings: SettingsStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val endpointKey = "server.endpoint.v1"

    var state: AppState = loadState()
        private set

    fun dispatch(action: AppAction): AppState {
        state = when (action) {
            is AppAction.SetupInputChanged -> state.copy(setupInput = action.value, setupError = null)
            AppAction.SaveEndpoint -> saveEndpoint()
            AppAction.ForgetEndpoint -> {
                settings.remove(endpointKey)
                AppState(notice = "Server connection removed")
            }
            is AppAction.Navigate -> state.copy(destination = action.destination)
            AppAction.DismissNotice -> state.copy(notice = null)
        }
        return state
    }

    private fun saveEndpoint(): AppState = when (val result = ServerEndpointValidator.validate(state.setupInput)) {
        is EndpointValidation.Invalid -> state.copy(setupError = result.message)
        is EndpointValidation.Valid -> {
            settings.put(endpointKey, json.encodeToString(result.endpoint))
            state.copy(endpoint = result.endpoint, setupError = null, notice = "Server saved")
        }
    }

    private fun loadState(): AppState {
        val endpoint = settings.get(endpointKey)?.let { encoded ->
            runCatching { json.decodeFromString<ServerEndpoint>(encoded) }.getOrNull()
        }
        return AppState(endpoint = endpoint, setupInput = endpoint?.baseUrl.orEmpty())
    }
}
