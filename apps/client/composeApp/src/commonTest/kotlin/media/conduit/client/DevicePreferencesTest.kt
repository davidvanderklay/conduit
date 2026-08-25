package media.conduit.client

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.client.foundation.DevicePreferences
import media.conduit.client.foundation.DevicePreferencesRepository
import media.conduit.client.foundation.MemorySettingsStore

class DevicePreferencesTest {
    @Test
    fun androidEnginePreferenceRoundTripsAsDeviceSetting() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        assertEquals(AndroidPlaybackEngine.Automatic, repository.load().androidPlaybackEngine)

        repository.save(DevicePreferences(androidPlaybackEngine = AndroidPlaybackEngine.Libmpv))

        assertEquals(AndroidPlaybackEngine.Libmpv, repository.load().androidPlaybackEngine)
    }
}
