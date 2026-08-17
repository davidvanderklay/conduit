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

    @Test
    fun iosEngineDefaultsToKsPlayer() {
        assertEquals(IosPlaybackEngine.KSPlayer, DevicePreferencesRepository(MemorySettingsStore()).load().iosPlaybackEngine)
    }

    @Test
    fun iosEnginePreferenceRoundTripsAsDeviceSetting() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        repository.save(DevicePreferences(iosPlaybackEngine = IosPlaybackEngine.MPVKit))

        assertEquals(IosPlaybackEngine.MPVKit, repository.load().iosPlaybackEngine)
    }

    @Test
    fun invalidIosEngineValueFallsBackToKsPlayer() {
        val store = MemorySettingsStore()
        store.put("preferences.v1.ios-playback-engine", "unknown")

        assertEquals(IosPlaybackEngine.KSPlayer, DevicePreferencesRepository(store).load().iosPlaybackEngine)
    }
}
