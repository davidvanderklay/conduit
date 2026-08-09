import ComposeApp
import SwiftUI

@main
struct ConduitMobileSpikeApp: App {
    init() {
        ConduitPlayerRegistration.register()
        ConduitPlatformRegistration.register()
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                ComposeView().ignoresSafeArea()
            }
            .preferredColorScheme(.dark)
            .onOpenURL { IosOAuthCallbacks.shared.capture(url: $0.absoluteString) }
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
