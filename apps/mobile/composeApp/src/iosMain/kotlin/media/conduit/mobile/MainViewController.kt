package media.conduit.mobile

import androidx.compose.ui.window.ComposeUIViewController

fun MainViewController(): platform.UIKit.UIViewController {
    startIosDiagnosticLogging()
    return ComposeUIViewController { App() }
}
