package media.conduit.mobile.foundation

enum class NavigationStyle(val label: String, val description: String) {
    Adaptive("Adaptive", "Compact on phones and expanded on larger screens"),
    Expanded("Always expanded", "Keep labels and the larger navigation treatment"),
    Compact("Always compact", "Use the smallest navigation treatment"),
    Classic("Classic", "Use a conventional full-width bottom bar"),
}

data class DevicePreferences(
    val amoledBlack: Boolean = false,
    val navigationStyle: NavigationStyle = NavigationStyle.Adaptive,
    val reduceAnimations: Boolean = false,
    val preferredAudioLanguage: String = "System default",
    val preferredSubtitleLanguage: String = "English",
    val subtitleSizePercent: Int = 100,
    val subtitleOffset: Int = 0,
    val subtitleOutline: Boolean = true,
    val touchGestures: Boolean = true,
    val holdToSpeed: Boolean = true,
    val autoSelectSavedStreams: Boolean = true,
    val lastStreamAddonId: String? = null,
    val miniplayerOnBack: Boolean = true,
    val autoplayNextEpisode: Boolean = false,
    val p2pEnabled: Boolean = false,
    val rememberLastProfile: Boolean = true,
    val debugLogging: Boolean = false,
)

class DevicePreferencesRepository(private val store: SettingsStore) {
    private val prefix = "preferences.v1."

    fun load() = DevicePreferences(
        amoledBlack = bool("amoled", false),
        navigationStyle = store.get(prefix + "navigation")?.let { runCatching { NavigationStyle.valueOf(it) }.getOrNull() } ?: NavigationStyle.Adaptive,
        reduceAnimations = bool("reduce-animations", false),
        preferredAudioLanguage = text("audio-language", "System default"),
        preferredSubtitleLanguage = text("subtitle-language", "English"),
        subtitleSizePercent = number("subtitle-size", 100),
        subtitleOffset = number("subtitle-offset", 0),
        subtitleOutline = bool("subtitle-outline", true),
        touchGestures = bool("touch-gestures", true),
        holdToSpeed = bool("hold-to-speed", true),
        autoSelectSavedStreams = bool("auto-select-saved-streams", true),
        lastStreamAddonId = store.get(prefix + "last-stream-addon-id")?.takeIf(String::isNotBlank),
        miniplayerOnBack = bool("miniplayer-on-back", true),
        autoplayNextEpisode = bool("autoplay-next", false),
        p2pEnabled = bool("p2p", false),
        rememberLastProfile = bool("remember-profile", true),
        debugLogging = bool("debug-logging", false),
    )

    fun save(value: DevicePreferences): DevicePreferences {
        store.put(prefix + "amoled", value.amoledBlack.toString())
        store.put(prefix + "navigation", value.navigationStyle.name)
        store.put(prefix + "reduce-animations", value.reduceAnimations.toString())
        store.put(prefix + "audio-language", value.preferredAudioLanguage)
        store.put(prefix + "subtitle-language", value.preferredSubtitleLanguage)
        store.put(prefix + "subtitle-size", value.subtitleSizePercent.toString())
        store.put(prefix + "subtitle-offset", value.subtitleOffset.toString())
        store.put(prefix + "subtitle-outline", value.subtitleOutline.toString())
        store.put(prefix + "touch-gestures", value.touchGestures.toString())
        store.put(prefix + "hold-to-speed", value.holdToSpeed.toString())
        store.put(prefix + "auto-select-saved-streams", value.autoSelectSavedStreams.toString())
        store.put(prefix + "last-stream-addon-id", value.lastStreamAddonId.orEmpty())
        store.put(prefix + "miniplayer-on-back", value.miniplayerOnBack.toString())
        store.put(prefix + "autoplay-next", value.autoplayNextEpisode.toString())
        store.put(prefix + "p2p", value.p2pEnabled.toString())
        store.put(prefix + "remember-profile", value.rememberLastProfile.toString())
        store.put(prefix + "debug-logging", value.debugLogging.toString())
        return value
    }

    private fun bool(key: String, fallback: Boolean) = store.get(prefix + key)?.toBooleanStrictOrNull() ?: fallback
    private fun number(key: String, fallback: Int) = store.get(prefix + key)?.toIntOrNull() ?: fallback
    private fun text(key: String, fallback: String) = store.get(prefix + key) ?: fallback
}
