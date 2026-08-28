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

object IosPlatformBridgeFactory {
    private var secureStore: IosSecureStoreBridge? = null
    private var oauthBridge: IosOAuthBridge? = null
    private var shareBridge: IosShareBridge? = null

    fun register(
        secureStore: IosSecureStoreBridge,
        oauthBridge: IosOAuthBridge,
        shareBridge: IosShareBridge,
    ) {
        this.secureStore = secureStore
        this.oauthBridge = oauthBridge
        this.shareBridge = shareBridge
    }

    fun secureStore(): IosSecureStoreBridge? = secureStore
    fun oauthBridge(): IosOAuthBridge? = oauthBridge
    fun shareBridge(): IosShareBridge? = shareBridge
}
