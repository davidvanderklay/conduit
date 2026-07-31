package media.conduit.mobile.foundation

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
        val saved = store.dispatch(AppAction.SaveEndpoint)
        assertEquals("https://media.example.test", saved.endpoint?.baseUrl)

        assertEquals(saved.endpoint, AppStore(settings).state.endpoint)
    }

    @Test
    fun invalidInputDoesNotReplaceExistingEndpoint() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged("not a url"))
        val state = store.dispatch(AppAction.SaveEndpoint)
        assertNull(state.endpoint)
        assertNotNull(state.setupError)
    }

    @Test
    fun forgettingEndpointReturnsToSetup() {
        val settings = MemorySettingsStore()
        val store = AppStore(settings)
        store.dispatch(AppAction.SetupInputChanged("https://media.example.test"))
        store.dispatch(AppAction.SaveEndpoint)
        assertNull(store.dispatch(AppAction.ForgetEndpoint).endpoint)
        assertNull(AppStore(settings).state.endpoint)
    }
}
