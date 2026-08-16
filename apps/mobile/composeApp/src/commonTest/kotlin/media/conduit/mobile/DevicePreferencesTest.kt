package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.foundation.DevicePreferences
import media.conduit.mobile.foundation.DevicePreferencesRepository
import media.conduit.mobile.foundation.MemorySettingsStore

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
