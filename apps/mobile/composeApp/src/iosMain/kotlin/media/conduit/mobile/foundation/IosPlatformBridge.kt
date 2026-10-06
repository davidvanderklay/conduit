package media.conduit.mobile.foundation

interface IosSecureStoreBridge {
    fun get(key: String): String?
    fun put(key: String, value: String): Int
    fun remove(key: String): Int
}

interface IosOAuthBridge {
    fun generateVerifier(): String
    fun challenge(verifier: String): String
    fun openSystemBrowser(url: String)
}

/** Presents the native share sheet from the iOS application host. */
interface IosShareBridge {
    fun shareText(text: String)
}

/** Native document picker callbacks return an error message or null on cancellation. */
interface IosProfileFilesBridge {
    fun pick(completion: (String?, String?, String?) -> Unit)
    fun save(name: String, contents: String, completion: (Boolean, String?) -> Unit)
}

interface IosAppEventsBridge {
    fun startConnectivity(onRecovered: () -> Unit): String
    fun stopConnectivity(subscription: String)
}

object IosPlatformBridgeFactory {
    private var appEvents: IosAppEventsBridge? = null
    fun registerAppEvents(bridge: IosAppEventsBridge) { appEvents = bridge }
    fun appEvents(): IosAppEventsBridge? = appEvents

    private var profileFiles: IosProfileFilesBridge? = null
    private var secureStore: IosSecureStoreBridge? = null
    private var oauthBridge: IosOAuthBridge? = null
    private var shareBridge: IosShareBridge? = null

    fun register(
        secureStore: IosSecureStoreBridge,
        oauthBridge: IosOAuthBridge,
        shareBridge: IosShareBridge,
        profileFiles: IosProfileFilesBridge,
    ) {
        this.profileFiles = profileFiles
        this.secureStore = secureStore
        this.oauthBridge = oauthBridge
        this.shareBridge = shareBridge
    }

    fun profileFiles(): IosProfileFilesBridge? = profileFiles
    fun secureStore(): IosSecureStoreBridge? = secureStore
    fun oauthBridge(): IosOAuthBridge? = oauthBridge
    fun shareBridge(): IosShareBridge? = shareBridge
}
