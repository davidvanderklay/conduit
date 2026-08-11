package media.conduit.mobile.foundation

import kotlin.test.Test
import kotlin.test.assertEquals

class DevicePreferencesTest {
    @Test
    fun savedStreamSelectionDefaultsToEnabled() {
        val preferences = DevicePreferencesRepository(MemorySettingsStore()).load()

        assertEquals(true, preferences.autoSelectSavedStreams)
    }

    @Test
    fun savedStreamSelectionRoundTripsAsADevicePreference() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        repository.save(repository.load().copy(autoSelectSavedStreams = false))

        assertEquals(false, repository.load().autoSelectSavedStreams)
    }
}
