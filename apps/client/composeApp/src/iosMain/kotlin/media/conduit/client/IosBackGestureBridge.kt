package media.conduit.client

/** Receives an interactive left-edge swipe from the native iOS host. */
interface IosBackGestureHandler {
    fun onBack()
    fun onBackCancelled()
    fun supportsInteractiveBack(): Boolean
}

/** Keeps the iOS gesture recognizer outside Compose's interop render layer. */
interface IosBackGestureBridge {
    fun update(handler: IosBackGestureHandler?)
}

object IosBackGestureBridgeFactory {
    private var bridge: IosBackGestureBridge? = null

    fun register(bridge: IosBackGestureBridge) {
        this.bridge = bridge
    }

    fun bridge(): IosBackGestureBridge? = bridge
}
