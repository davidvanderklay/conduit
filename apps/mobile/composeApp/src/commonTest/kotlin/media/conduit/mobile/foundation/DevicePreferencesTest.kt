package media.conduit.mobile.foundation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DevicePreferencesTest {
    @Test
    fun playbackPreferencesMigrateAndRoundTrip() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)
        assertEquals(ResumeBehavior.Ask, repository.load().resumeBehavior)
        assertEquals(null, repository.load().readAheadSeconds)
        assertEquals(true, repository.load().hardwareDecoding)
        store.put("preferences.v1.amoled", "false")
        assertEquals(ResumeBehavior.Always, repository.load().resumeBehavior)
        val saved = repository.save(repository.load().copy(resumeBehavior = ResumeBehavior.Restart, readAheadSeconds = 45, hardwareDecoding = false))
        assertEquals(saved, repository.load())
        repository.save(saved.copy(readAheadSeconds = null))
        assertEquals(null, repository.load().readAheadSeconds)
    }

    @Test
    fun invalidPlaybackPreferencesUseSafeValues() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)
        store.put("preferences.v1.resume-behavior", "unknown")
        store.put("preferences.v1.hardware-decoding", "invalid")
        store.put("preferences.v1.read-ahead-seconds", "invalid")
        assertEquals(ResumeBehavior.Ask, repository.load().resumeBehavior)
        assertEquals(true, repository.load().hardwareDecoding)
        assertEquals(null, repository.load().readAheadSeconds)
        store.put("preferences.v1.read-ahead-seconds", "900")
        assertEquals(120, repository.load().readAheadSeconds)
        store.put("preferences.v1.read-ahead-seconds", "-4")
        assertEquals(10, repository.load().readAheadSeconds)
        assertEquals(120, repository.save(repository.load().copy(readAheadSeconds = 900)).readAheadSeconds)
        assertEquals(10, repository.save(repository.load().copy(readAheadSeconds = -4)).readAheadSeconds)
    }

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

    @Test
    fun subtitleStyleRoundTripsAndClampsStoredValues() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)

        assertEquals(SubtitleStyle(), repository.load().subtitleStyle)
        val style = SubtitleStyle(sizePercent = 140, offsetPercent = 12, outline = false)
        repository.save(repository.load().copy(subtitleStyle = style))
        assertEquals(style, repository.load().subtitleStyle)

        store.put("preferences.v1.subtitle-size", "900")
        store.put("preferences.v1.subtitle-offset", "-4")
        assertEquals(
            SubtitleStyle(sizePercent = 200, offsetPercent = 0, outline = false),
            repository.load().subtitleStyle,
        )
    }

    @Test
    fun languagePreferencesMigrateFromDisplayNamesToCodes() {
        val store = MemorySettingsStore()
        val repository = DevicePreferencesRepository(store)
        assertEquals("auto", repository.load().preferredAudioLanguage)
        assertEquals("en", repository.load().preferredSubtitleLanguage)

        store.put("preferences.v1.audio-language", "Japanese")
        store.put("preferences.v1.subtitle-language", "System default")
        assertEquals("ja", repository.load().preferredAudioLanguage)
        assertEquals("auto", repository.load().preferredSubtitleLanguage)

        repository.save(repository.load().copy(preferredSubtitleLanguage = "sv"))
        assertEquals("ja", store.get("preferences.v1.audio-language"))
        assertEquals("sv", repository.load().preferredSubtitleLanguage)
    }
}
