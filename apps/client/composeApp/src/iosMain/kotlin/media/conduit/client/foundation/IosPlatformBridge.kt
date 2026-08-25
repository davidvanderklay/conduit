package media.conduit.client.foundation

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

object IosPlatformBridgeFactory {
    private var secureStore: IosSecureStoreBridge? = null
    private var oauthBridge: IosOAuthBridge? = null

    fun register(secureStore: IosSecureStoreBridge, oauthBridge: IosOAuthBridge) {
        this.secureStore = secureStore
        this.oauthBridge = oauthBridge
    }

    fun secureStore(): IosSecureStoreBridge? = secureStore
    fun oauthBridge(): IosOAuthBridge? = oauthBridge
}
