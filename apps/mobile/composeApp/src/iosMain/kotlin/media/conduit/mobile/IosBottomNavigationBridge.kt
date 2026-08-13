package media.conduit.mobile

/** Receives tab selections from the native SwiftUI overlay. */
interface IosBottomNavigationSelectionHandler {
    fun select(index: Int)
}

/** Keeps the system-owned iOS tab bar outside Compose's interop render layer. */
interface IosBottomNavigationBridge {
    fun update(
        visible: Boolean,
        selectedIndex: Int,
        labels: List<String>,
        compact: Boolean,
        classic: Boolean,
        adaptive: Boolean,
        selectionHandler: IosBottomNavigationSelectionHandler?,
    )
}

object IosBottomNavigationBridgeFactory {
    private var bridge: IosBottomNavigationBridge? = null

    fun register(bridge: IosBottomNavigationBridge) {
        this.bridge = bridge
    }

    fun bridge(): IosBottomNavigationBridge? = bridge
}
