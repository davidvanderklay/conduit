import ComposeApp
import SwiftUI

final class ConduitAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        ConduitOrientationCoordinator.shared.supportedOrientations
    }
}

/// Keeps the rest of the app portrait-only while allowing the player to own
/// both landscape orientations, matching the Android player behavior.
final class ConduitOrientationCoordinator {
    static let shared = ConduitOrientationCoordinator()

    private(set) var supportedOrientations: UIInterfaceOrientationMask = .portrait

    private init() {}

    func lockPlayerToLandscape() {
        updateOrientation(to: .landscape)
    }

    func restorePortrait() {
        updateOrientation(to: .portrait)
    }

    private func updateOrientation(to mask: UIInterfaceOrientationMask) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.updateOrientation(to: mask) }
            return
        }

        supportedOrientations = mask
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        else { return }

        if #available(iOS 16.0, *) {
            scene.windows.first(where: \.isKeyWindow)?
                .rootViewController?
                .setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(
                .iOS(interfaceOrientations: mask)
            ) { error in
                print("[Conduit] Could not update player orientation: \(error)")
            }
        } else {
            UIDevice.current.setValue(
                mask == .portrait
                    ? UIInterfaceOrientation.portrait.rawValue
                    : UIInterfaceOrientation.landscapeRight.rawValue,
                forKey: "orientation"
            )
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}

@main
struct ConduitMobileSpikeApp: App {
    @UIApplicationDelegateAdaptor(ConduitAppDelegate.self) private var appDelegate

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
