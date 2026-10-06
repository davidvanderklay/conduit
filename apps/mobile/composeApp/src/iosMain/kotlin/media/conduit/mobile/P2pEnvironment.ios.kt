package media.conduit.mobile

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/** Swift supplies NWPathMonitor and ProcessInfo policy without moving media
 * or player objects through the Rust bridge. */
interface IosP2pEnvironmentBridge {
    fun cacheDirectory(): String
    fun transfersAllowed(): Boolean
    fun appActive(): Boolean
}

object IosP2pEnvironmentFactory {
    private var bridge: IosP2pEnvironmentBridge? = null
    fun register(value: IosP2pEnvironmentBridge) { bridge = value }
    internal fun environment(): IosP2pEnvironmentBridge = checkNotNull(bridge) { "P2P platform policy is unregistered" }
}

@Composable
internal actual fun rememberP2pEnvironment(): P2pEnvironment = remember {
    object : P2pEnvironment {
        override val cacheDirectory get() = IosP2pEnvironmentFactory.environment().cacheDirectory()
        override fun appActive() = IosP2pEnvironmentFactory.environment().appActive()
        override fun transfersAllowed() = IosP2pEnvironmentFactory.environment().transfersAllowed()
    }
}
