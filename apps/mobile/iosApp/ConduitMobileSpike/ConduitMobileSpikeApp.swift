import ComposeApp
import Combine
import SwiftUI
import UIKit

final class ConduitAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        IosOAuthCallbacks.shared.capture(url: url.absoluteString)
        return true
    }

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        ConduitOrientationCoordinator.shared.supportedOrientations
    }
}

/// Owns the system UI state for the full-screen player.
///
/// The MPV controller is embedded below Compose, so its UIKit appearance
/// preferences do not reliably reach the SwiftUI scene that owns the window.
/// SwiftUI observes this coordinator and applies the state at the real host
/// boundary instead.
final class ConduitSystemChromeCoordinator: ObservableObject {
    static let shared = ConduitSystemChromeCoordinator()

    @Published private(set) var immersivePlayback = false

    private init() {}

    func setImmersivePlayback(_ enabled: Bool) {
        performOnMain { [weak self] in
            guard let self, self.immersivePlayback != enabled else { return }
            self.immersivePlayback = enabled
            self.requestAppearanceUpdate()
        }
    }

    private func requestAppearanceUpdate() {
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })?
            .windows
            .first(where: \.isKeyWindow)
        else { return }

        window.rootViewController?.setNeedsStatusBarAppearanceUpdate()
        window.rootViewController?.setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    private func performOnMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }
}

/// Keeps the rest of the app portrait-only while allowing the player to own
/// both landscape orientations, matching the Android player behavior.
final class ConduitOrientationCoordinator {
    static let shared = ConduitOrientationCoordinator()

    private(set) var supportedOrientations: UIInterfaceOrientationMask = .portrait
    private var activePlaybackCount = 0
    private var observers: [NSObjectProtocol] = []

    private init() {
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { _ in UIApplication.shared.isIdleTimerDisabled = false })
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.updateIdleTimer() })
    }

    func beginPlayback() {
        performOnMain { [weak self] in
            guard let self else { return }
            self.activePlaybackCount += 1
            self.updateIdleTimer()
        }
    }

    func endPlayback() {
        performOnMain { [weak self] in
            guard let self else { return }
            self.activePlaybackCount = max(0, self.activePlaybackCount - 1)
            self.updateIdleTimer()
        }
    }

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

    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = activePlaybackCount > 0 &&
            UIApplication.shared.applicationState == .active
    }

    private func performOnMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }
}

@main
struct ConduitMobileSpikeApp: App {
    @UIApplicationDelegateAdaptor(ConduitAppDelegate.self) private var appDelegate
    @StateObject private var systemChrome = ConduitSystemChromeCoordinator.shared

    init() {
        ConduitPlayerRegistration.register()
        ConduitPlatformRegistration.register()
    }

    var body: some Scene {
        WindowGroup {
            ConduitRootView(systemChrome: systemChrome)
            .preferredColorScheme(.dark)
            .onOpenURL { IosOAuthCallbacks.shared.capture(url: $0.absoluteString) }
        }
    }
}

private struct ConduitRootView: View {
    @ObservedObject var systemChrome: ConduitSystemChromeCoordinator

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ComposeView().ignoresSafeArea()
        }
        .statusBarHidden(systemChrome.immersivePlayback)
        .modifier(ConduitPersistentSystemOverlaysModifier(hidden: systemChrome.immersivePlayback))
    }
}

private struct ConduitPersistentSystemOverlaysModifier: ViewModifier {
    let hidden: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 16.0, *) {
            content.persistentSystemOverlays(hidden ? .hidden : .automatic)
        } else {
            content
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
