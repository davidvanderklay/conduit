package media.conduit.client.foundation

import media.conduit.client.account.SessionVault
import media.conduit.client.account.StoredSession
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
        assertEquals(DefaultServerEndpoint, state.endpoint)
        assertNotNull(state.setupError)
    }

    @Test
    fun defaultServerConnectionCompletesWithCanonicalEndpoint() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged(DefaultServerEndpoint.baseUrl))

        val pending = assertNotNull(store.dispatch(AppAction.ConnectRequested).pendingEndpoint)
        assertEquals(DefaultServerEndpoint, pending)

        val connected = store.dispatch(AppAction.ConnectionSucceeded(DefaultServerEndpoint))
        assertEquals(DefaultServerEndpoint, connected.endpoint)
        assertNull(connected.pendingEndpoint)
    }

    @Test
    fun forgettingEndpointReturnsToDefaultServer() {
        val settings = MemorySettingsStore()
        val secure = MemorySecureStore()
        val sessions = SessionVault(secure)
        val store = AppStore(settings, sessions)
        store.dispatch(AppAction.SetupInputChanged("https://media.example.test"))
        val endpoint = assertNotNull(store.dispatch(AppAction.ConnectRequested).pendingEndpoint)
        store.dispatch(AppAction.ConnectionSucceeded(endpoint))
        sessions.save(StoredSession(endpoint.baseUrl, "secret", "2099-01-01T00:00:00Z"))
        assertEquals(DefaultServerEndpoint, store.dispatch(AppAction.ForgetEndpoint).endpoint)
        assertEquals(DefaultServerEndpoint, AppStore(settings).state.endpoint)
        assertNull(sessions.loadFor(endpoint.baseUrl))
    }

    @Test
    fun failedConnectionDoesNotPersistEndpoint() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged("https://offline.example.test"))
        assertNotNull(store.dispatch(AppAction.ConnectRequested).pendingEndpoint)

        val failed = store.dispatch(AppAction.ConnectionFailed("Connection refused"))
        assertEquals(DefaultServerEndpoint, failed.endpoint)
        assertNull(failed.pendingEndpoint)
        assertEquals("Connection refused", failed.setupError)
        assertEquals(DefaultServerEndpoint, AppStore(settings).state.endpoint)
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
        assertEquals(DefaultServerEndpoint, state.endpoint)
        assertEquals("https://expected.example.test", state.pendingEndpoint?.baseUrl)
    }

    @Test
    fun selectedProfilePersistsLocally() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SelectProfile("profile-7"))
        assertEquals("profile-7", AppStore(settings).state.activeProfileId)
    }

    @Test
    fun richActionsHintIsOnlyShownOnce() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)

        assertEquals(false, store.state.richActionsHintShown)
        assertEquals(true, store.dispatch(AppAction.RichActionsHintShown).richActionsHintShown)
        assertEquals(true, AppStore(settings).state.richActionsHintShown)
        assertEquals(true, store.dispatch(AppAction.ForgetEndpoint).richActionsHintShown)
    }
}
