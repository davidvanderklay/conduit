package media.conduit.mobile

/** Receives a completed left-edge swipe from the native iOS host. */
interface IosBackGestureHandler {
    fun onBack()
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
