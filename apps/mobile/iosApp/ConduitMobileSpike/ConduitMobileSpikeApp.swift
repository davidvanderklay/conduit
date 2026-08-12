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
    @StateObject private var bottomNavigation = ConduitBottomNavigationCoordinator.shared

    init() {
        ConduitPlayerRegistration.register()
        ConduitPlatformRegistration.register()
        IosBottomNavigationBridgeFactory.shared.register(
            bridge: ConduitBottomNavigationCoordinator.shared
        )
    }

    var body: some Scene {
        WindowGroup {
            ConduitRootView(
                systemChrome: systemChrome,
                bottomNavigation: bottomNavigation
            )
            .preferredColorScheme(.dark)
            .onOpenURL { IosOAuthCallbacks.shared.capture(url: $0.absoluteString) }
        }
    }
}

private struct ConduitRootView: View {
    @ObservedObject var systemChrome: ConduitSystemChromeCoordinator
    @ObservedObject var bottomNavigation: ConduitBottomNavigationCoordinator

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                Color.black.ignoresSafeArea()
                ComposeView().ignoresSafeArea()

                if bottomNavigation.visible {
                    ConduitBottomTabBar(coordinator: bottomNavigation)
                        .frame(height: 76)
                        .padding(.horizontal, bottomNavigation.classic ? 0 : (bottomNavigation.compact ? 64 : 24))
                        .padding(.bottom, geometry.safeAreaInsets.bottom)
                        .animation(.easeInOut(duration: 0.22), value: bottomNavigation.compact)
                }
            }
            .ignoresSafeArea()
        }
        .statusBarHidden(systemChrome.immersivePlayback)
        .modifier(ConduitPersistentSystemOverlaysModifier(hidden: systemChrome.immersivePlayback))
    }
}

final class ConduitBottomNavigationCoordinator: NSObject, ObservableObject, IosBottomNavigationBridge {
    static let shared = ConduitBottomNavigationCoordinator()

    @Published private(set) var visible = false
    @Published private(set) var selectedIndex: Int = 0
    @Published private(set) var labels: [String] = []
    @Published private(set) var compact = false
    @Published private(set) var classic = false
    @Published private(set) var adaptive = false
    private var selectionHandler: IosBottomNavigationSelectionHandler?

    private override init() {}

    func update(
        visible: Bool,
        selectedIndex: Int32,
        labels: [String],
        compact: Bool,
        classic: Bool,
        adaptive: Bool,
        selectionHandler: IosBottomNavigationSelectionHandler?
    ) {
        let apply = { [weak self] in
            guard let self else { return }
            self.visible = visible
            self.selectedIndex = Int(selectedIndex)
            self.labels = labels
            self.compact = compact
            self.classic = classic
            self.adaptive = adaptive
            self.selectionHandler = selectionHandler
        }
        if Thread.isMainThread { apply() } else { DispatchQueue.main.async(execute: apply) }
    }

    fileprivate func select(_ index: Int) {
        selectionHandler?.select(index: Int32(index))
    }
}

private struct ConduitBottomTabBar: UIViewControllerRepresentable {
    @ObservedObject var coordinator: ConduitBottomNavigationCoordinator

    func makeCoordinator() -> Delegate {
        Delegate(owner: coordinator)
    }

    func makeUIViewController(context: Context) -> UITabBarController {
        let controller = UITabBarController()
        controller.delegate = context.coordinator
        controller.view.backgroundColor = .clear
        controller.view.isOpaque = false
        controller.tabBar.tintColor = UIColor(red: 0.98, green: 0.75, blue: 0.14, alpha: 1)
        controller.tabBar.unselectedItemTintColor = UIColor.white.withAlphaComponent(0.55)
        controller.tabBar.backgroundColor = .clear
        controller.tabBar.isOpaque = false
        if #available(iOS 26.0, *) {
            controller.tabBarMinimizeBehavior = .automatic
        }
        return controller
    }

    func updateUIViewController(_ controller: UITabBarController, context: Context) {
        context.coordinator.owner = coordinator
        let titles = coordinator.labels.map { coordinator.compact ? nil : $0 }
        if controller.viewControllers?.count != coordinator.labels.count {
            let viewControllers = coordinator.labels.enumerated().map { index, label in
                let viewController = UIViewController()
                viewController.view.backgroundColor = .clear
                viewController.view.isOpaque = false
                viewController.tabBarItem = UITabBarItem(
                    title: titles[index],
                    image: UIImage(systemName: systemImageName(for: label)),
                    tag: index
                )
                return viewController
            }
            controller.setViewControllers(viewControllers, animated: false)
        } else {
            controller.viewControllers?.enumerated().forEach { index, viewController in
                viewController.tabBarItem.title = titles[index]
            }
        }
        controller.selectedIndex = coordinator.selectedIndex
        if #available(iOS 26.0, *) {
            controller.tabBarMinimizeBehavior = coordinator.adaptive && !coordinator.compact
                ? .automatic
                : .never
        }
        let targetTransform = CGAffineTransform(
            scaleX: 1,
            y: coordinator.compact ? 0.68 : 1
        )
        if let lastCompact = context.coordinator.lastCompact,
           lastCompact != coordinator.compact {
            UIView.animate(
                withDuration: 0.22,
                delay: 0,
                options: [.beginFromCurrentState, .curveEaseInOut]
            ) {
                controller.tabBar.transform = targetTransform
            }
        } else {
            controller.tabBar.transform = targetTransform
        }
        context.coordinator.lastCompact = coordinator.compact
    }

    private func systemImageName(for label: String) -> String {
        switch label {
        case "Home": "house"
        case "Discover": "safari"
        case "Library": "rectangle.stack"
        case "Settings": "gearshape"
        default: "circle"
        }
    }

    final class Delegate: NSObject, UITabBarControllerDelegate {
        var owner: ConduitBottomNavigationCoordinator
        var lastCompact: Bool?

        init(owner: ConduitBottomNavigationCoordinator) {
            self.owner = owner
        }

        func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
            owner.select(viewController.tabBarItem.tag)
        }
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
