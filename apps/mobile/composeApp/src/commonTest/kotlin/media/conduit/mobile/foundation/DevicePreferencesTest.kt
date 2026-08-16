package media.conduit.mobile.foundation

import kotlin.test.Test
import kotlin.test.assertEquals

class DevicePreferencesTest {
    @Test
    fun savedStreamSelectionDefaultsToDisabled() {
        val preferences = DevicePreferencesRepository(MemorySettingsStore()).load()

        assertEquals(false, preferences.autoSelectSavedStreams)
    }

    @Test
    fun miniplayerOnBackDefaultsToEnabled() {
        val preferences = DevicePreferencesRepository(MemorySettingsStore()).load()

        assertEquals(true, preferences.miniplayerOnBack)
    }

    @Test
    fun miniplayerOnBackRoundTripsAsADevicePreference() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        repository.save(repository.load().copy(miniplayerOnBack = false))

        assertEquals(false, repository.load().miniplayerOnBack)
    }

    @Test
    fun savedStreamSelectionRoundTripsAsADevicePreference() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        repository.save(repository.load().copy(autoSelectSavedStreams = true))

        assertEquals(true, repository.load().autoSelectSavedStreams)
    }

    @Test
    fun lastStreamAddonRoundTripsAsADevicePreference() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        repository.save(repository.load().copy(lastStreamAddonId = "torrentio"))

        assertEquals("torrentio", repository.load().lastStreamAddonId)
    }

    @Test
    fun compactNavigationMigratesToAdaptiveOnIos() {
        val preferences = DevicePreferences(navigationStyle = NavigationStyle.Compact)

        assertEquals(NavigationStyle.Adaptive, preferences.normalizedForPlatform("iOS").navigationStyle)
    }

    @Test
    fun compactNavigationRemainsAvailableOnAndroid() {
        val preferences = DevicePreferences(navigationStyle = NavigationStyle.Compact)

        assertEquals(NavigationStyle.Compact, preferences.normalizedForPlatform("Android").navigationStyle)
    }
}
