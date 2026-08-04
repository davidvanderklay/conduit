import ComposeApp
import SwiftUI

@main
struct ConduitMobileSpikeApp: App {
    init() {
        ConduitPlayerRegistration.register()
    }

    var body: some Scene {
        WindowGroup {
            ComposeView()
                .ignoresSafeArea(.keyboard)
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
