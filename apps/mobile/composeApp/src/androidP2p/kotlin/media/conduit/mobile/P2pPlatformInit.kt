package media.conduit.mobile

internal fun initializeP2pPlatform(context: android.content.Context) { RustBridge.initializeP2pTls(context) }
