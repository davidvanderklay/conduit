package media.conduit.mobile.foundation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DevicePreferencesTest {
    @Test
    fun savedStreamSelectionDefaultsToDisabled() {
        val preferences = DevicePreferencesRepository(MemorySettingsStore()).load()

        assertEquals(false, preferences.autoSelectSavedStreams)
    }

    @Test
    fun nextStreamSelectionDefaultsToEnabledAndRoundTrips() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        assertEquals(true, repository.load().autoSelectNextStreams)
        repository.save(repository.load().copy(autoSelectNextStreams = false))
        assertEquals(false, repository.load().autoSelectNextStreams)
    }

    @Test
    fun miniplayerOnBackDefaultsToEnabled() {
        val preferences = DevicePreferencesRepository(MemorySettingsStore()).load()

        assertEquals(true, preferences.miniplayerOnBack)
    }

    @Test
    fun skipSegmentsDefaultsToEnabledAndRoundTrips() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        assertEquals(true, repository.load().skipSegments)
        repository.save(repository.load().copy(skipSegments = false))
        assertEquals(false, repository.load().skipSegments)
    }

    @Test
    fun skipButtonPositionDefaultsLeftAndRoundTrips() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        assertEquals(SkipButtonPosition.Left, repository.load().skipButtonPosition)
        repository.save(repository.load().copy(skipButtonPosition = SkipButtonPosition.Right))

        assertEquals(SkipButtonPosition.Right, repository.load().skipButtonPosition)
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
    fun ipadOsIsRecognizedAsAnIosTablet() {
        assertTrue("iPadOS".isIosPlatformName())
        assertTrue(PlatformInfo("iPadOS", "26.0", "iPad", isTablet = true).isIpad())
    }

    @Test
    fun androidTabletDetectionUsesTheSmallestWidthQualifier() {
        assertFalse(isTabletSmallestWidth(599))
        assertTrue(isTabletSmallestWidth(600))
    }

    @Test
    fun compactNavigationRemainsAvailableOnAndroid() {
        val preferences = DevicePreferences(navigationStyle = NavigationStyle.Compact)

        assertEquals(NavigationStyle.Compact, preferences.normalizedForPlatform("Android").navigationStyle)
    }
}
