package media.conduit.mobile.foundation

import media.conduit.mobile.AndroidPlaybackEngine

enum class NavigationStyle(val label: String, val description: String) {
    Adaptive("Adaptive", "Hide the full bar while scrolling on iOS; compact on Android phones"),
    Expanded("Always expanded", "Keep labels and the larger navigation treatment"),
    Compact("Always compact", "Use the smallest navigation treatment on Android"),
    Classic("Classic", "Use a conventional full-width bottom bar"),
}

enum class SkipButtonPosition(val label: String, val description: String) {
    Left("Left", "Keep skip prompts on the left side of the player"),
    Right("Right", "Place skip prompts on the right side of the player"),
}

data class DevicePreferences(
    val amoledBlack: Boolean = false,
    val navigationStyle: NavigationStyle = NavigationStyle.Adaptive,
    val railOnTablets: Boolean = false,
    val reduceAnimations: Boolean = false,
    val preferredAudioLanguage: String = "System default",
    val preferredSubtitleLanguage: String = "English",
    val subtitleSizePercent: Int = 100,
    val subtitleOffset: Int = 0,
    val subtitleOutline: Boolean = true,
    val touchGestures: Boolean = true,
    val holdToSpeed: Boolean = true,
    val autoSelectSavedStreams: Boolean = false,
    val autoSelectNextStreams: Boolean = true,
    val lastStreamAddonId: String? = null,
    val miniplayerOnBack: Boolean = true,
    val autoplayNextEpisode: Boolean = false,
    val skipSegments: Boolean = true,
    val skipButtonPosition: SkipButtonPosition = SkipButtonPosition.Left,
    val p2pEnabled: Boolean = false,
    val androidPlaybackEngine: AndroidPlaybackEngine = AndroidPlaybackEngine.Automatic,
    val rememberLastProfile: Boolean = true,
    val debugLogging: Boolean = false,
)

fun DevicePreferences.normalizedForPlatform(platformName: String): DevicePreferences =
    if (platformName.equals("iOS", ignoreCase = true) && navigationStyle == NavigationStyle.Compact) {
        copy(navigationStyle = NavigationStyle.Adaptive)
    } else {
        this
    }

class DevicePreferencesRepository(private val store: SettingsStore) {
    private val prefix = "preferences.v1."

    fun load() = DevicePreferences(
        amoledBlack = bool("amoled", false),
        navigationStyle = store.get(prefix + "navigation")?.let { runCatching { NavigationStyle.valueOf(it) }.getOrNull() } ?: NavigationStyle.Adaptive,
        railOnTablets = bool("rail-on-tablets", false),
        reduceAnimations = bool("reduce-animations", false),
        preferredAudioLanguage = text("audio-language", "System default"),
        preferredSubtitleLanguage = text("subtitle-language", "English"),
        subtitleSizePercent = number("subtitle-size", 100),
        subtitleOffset = number("subtitle-offset", 0),
        subtitleOutline = bool("subtitle-outline", true),
        touchGestures = bool("touch-gestures", true),
        holdToSpeed = bool("hold-to-speed", true),
        autoSelectSavedStreams = bool("auto-select-saved-streams", false),
        autoSelectNextStreams = bool("auto-select-next-streams", true),
        lastStreamAddonId = store.get(prefix + "last-stream-addon-id")?.takeIf(String::isNotBlank),
        miniplayerOnBack = bool("miniplayer-on-back", true),
        autoplayNextEpisode = bool("autoplay-next", false),
        skipSegments = bool("skip-segments", true),
        skipButtonPosition = store.get(prefix + "skip-button-position")
            ?.let { runCatching { SkipButtonPosition.valueOf(it) }.getOrNull() }
            ?: SkipButtonPosition.Left,
        p2pEnabled = bool("p2p", false),
        androidPlaybackEngine = store.get(prefix + "android-playback-engine")
            ?.let { runCatching { AndroidPlaybackEngine.valueOf(it) }.getOrNull() }
            ?: AndroidPlaybackEngine.Automatic,
        rememberLastProfile = bool("remember-profile", true),
        debugLogging = bool("debug-logging", false),
    )

    fun save(value: DevicePreferences): DevicePreferences {
        store.put(prefix + "amoled", value.amoledBlack.toString())
        store.put(prefix + "navigation", value.navigationStyle.name)
        store.put(prefix + "rail-on-tablets", value.railOnTablets.toString())
        store.put(prefix + "reduce-animations", value.reduceAnimations.toString())
        store.put(prefix + "audio-language", value.preferredAudioLanguage)
        store.put(prefix + "subtitle-language", value.preferredSubtitleLanguage)
        store.put(prefix + "subtitle-size", value.subtitleSizePercent.toString())
        store.put(prefix + "subtitle-offset", value.subtitleOffset.toString())
        store.put(prefix + "subtitle-outline", value.subtitleOutline.toString())
        store.put(prefix + "touch-gestures", value.touchGestures.toString())
        store.put(prefix + "hold-to-speed", value.holdToSpeed.toString())
        store.put(prefix + "auto-select-saved-streams", value.autoSelectSavedStreams.toString())
        store.put(prefix + "auto-select-next-streams", value.autoSelectNextStreams.toString())
        store.put(prefix + "last-stream-addon-id", value.lastStreamAddonId.orEmpty())
        store.put(prefix + "miniplayer-on-back", value.miniplayerOnBack.toString())
        store.put(prefix + "autoplay-next", value.autoplayNextEpisode.toString())
        store.put(prefix + "skip-segments", value.skipSegments.toString())
        store.put(prefix + "skip-button-position", value.skipButtonPosition.name)
        store.put(prefix + "p2p", value.p2pEnabled.toString())
        store.put(prefix + "android-playback-engine", value.androidPlaybackEngine.name)
        store.put(prefix + "remember-profile", value.rememberLastProfile.toString())
        store.put(prefix + "debug-logging", value.debugLogging.toString())
        return value
    }

    private fun bool(key: String, fallback: Boolean) = store.get(prefix + key)?.toBooleanStrictOrNull() ?: fallback
    private fun number(key: String, fallback: Int) = store.get(prefix + key)?.toIntOrNull() ?: fallback
    private fun text(key: String, fallback: String) = store.get(prefix + key) ?: fallback
}
