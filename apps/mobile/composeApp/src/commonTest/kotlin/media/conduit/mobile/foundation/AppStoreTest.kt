package media.conduit.mobile.foundation

import media.conduit.mobile.account.SessionVault
import media.conduit.mobile.account.StoredSession
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class AppStoreTest {
    @Test
    fun savesAndRestoresEndpoint() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged("https://media.example.test/"))
        val pending = store.dispatch(AppAction.ConnectRequested).pendingEndpoint
        assertNotNull(pending)
        val saved = store.dispatch(AppAction.ConnectionSucceeded(pending))
        assertEquals("https://media.example.test", saved.endpoint?.baseUrl)

        assertEquals(saved.endpoint, AppStore(settings).state.endpoint)
    }

    @Test
    fun invalidInputDoesNotReplaceExistingEndpoint() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged("not a url"))
        val state = store.dispatch(AppAction.ConnectRequested)
        assertNull(state.endpoint)
        assertNotNull(state.setupError)
    }

    @Test
    fun forgettingEndpointReturnsToSetup() {
        val settings = MemorySettingsStore()
        val secure = MemorySecureStore()
        val sessions = SessionVault(secure)
        val store = AppStore(settings, sessions)
        store.dispatch(AppAction.SetupInputChanged("https://media.example.test"))
        val endpoint = assertNotNull(store.dispatch(AppAction.ConnectRequested).pendingEndpoint)
        store.dispatch(AppAction.ConnectionSucceeded(endpoint))
        sessions.save(StoredSession(endpoint.baseUrl, "secret", "2099-01-01T00:00:00Z"))
        assertNull(store.dispatch(AppAction.ForgetEndpoint).endpoint)
        assertNull(AppStore(settings).state.endpoint)
        assertNull(sessions.loadFor(endpoint.baseUrl))
    }

    @Test
    fun failedConnectionDoesNotPersistEndpoint() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged("https://offline.example.test"))
        assertNotNull(store.dispatch(AppAction.ConnectRequested).pendingEndpoint)

        val failed = store.dispatch(AppAction.ConnectionFailed("Connection refused"))
        assertNull(failed.endpoint)
        assertNull(failed.pendingEndpoint)
        assertEquals("Connection refused", failed.setupError)
        assertNull(AppStore(settings).state.endpoint)
    }

    @Test
    fun ignoresStaleConnectionSuccess() {
        val store = AppStore(MemorySettingsStore())
        store.dispatch(AppAction.SetupInputChanged("https://expected.example.test"))
        store.dispatch(AppAction.ConnectRequested)

        val state = store.dispatch(
            AppAction.ConnectionSucceeded(
                ServerEndpoint("https://stale.example.test", "stale.example.test"),
            ),
        )
        assertNull(state.endpoint)
        assertEquals("https://expected.example.test", state.pendingEndpoint?.baseUrl)
    }
}
