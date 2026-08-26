package media.conduit.client

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.rememberWindowState
import androidx.compose.ui.window.application
import androidx.compose.ui.unit.dp
import java.awt.Dimension

fun main() = application {
    val windowState = rememberWindowState(width = 1200.dp, height = 800.dp)
    Window(
        state = windowState,
        onCloseRequest = ::exitApplication,
        title = "Conduit",
    ) {
        window.minimumSize = Dimension(960, 680)
        App()
    }
}
