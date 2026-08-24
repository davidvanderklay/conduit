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
    private var immersivePlaybackCount = 0

    private init() {}

    func beginImmersivePlayback() {
        performOnMain { [weak self] in
            guard let self else { return }
            self.immersivePlaybackCount += 1
            if !self.immersivePlayback {
                self.immersivePlayback = true
                self.requestAppearanceUpdate()
            }
        }
    }

    func endImmersivePlayback() {
        performOnMain { [weak self] in
            guard let self else { return }
            self.immersivePlaybackCount = max(0, self.immersivePlaybackCount - 1)
            if self.immersivePlaybackCount == 0 && self.immersivePlayback {
                self.immersivePlayback = false
                self.requestAppearanceUpdate()
            }
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
    private var landscapeLockCount = 0
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

    func beginLandscapeLock() {
        performOnMain { [weak self] in
            guard let self else { return }
            self.landscapeLockCount += 1
            if self.landscapeLockCount == 1 {
                self.updateOrientation(to: .landscape)
            }
        }
    }

    func endLandscapeLock() {
        performOnMain { [weak self] in
            guard let self else { return }
            self.landscapeLockCount = max(0, self.landscapeLockCount - 1)
            if self.landscapeLockCount == 0 {
                self.updateOrientation(to: .portrait)
            }
        }
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
        _ = ConduitKeyboardCoordinator.shared
        IosBottomNavigationBridgeFactory.shared.register(
            bridge: ConduitBottomNavigationCoordinator.shared
        )
        IosBackGestureBridgeFactory.shared.register(
            bridge: ConduitBackGestureCoordinator.shared
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
                ConduitSafeAreaProbe()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
                Color.black.ignoresSafeArea()
                ComposeView().ignoresSafeArea()

                if !bottomNavigation.labels.isEmpty {
                    ConduitBottomTabBar(coordinator: bottomNavigation)
                        .frame(
                            width: bottomNavigation.classic
                                ? geometry.size.width
                                : min(geometry.size.width - 48, 480)
                        )
                        .frame(height: 88)
                        .padding(.bottom, bottomNavigation.classic ? geometry.safeAreaInsets.bottom : max(geometry.safeAreaInsets.bottom - 32, 0))
                        .offset(y: bottomNavigation.visible ? 0 : 120)
                        .opacity(bottomNavigation.visible ? 1 : 0)
                        .allowsHitTesting(bottomNavigation.visible)
                        .animation(.easeInOut(duration: 0.22), value: bottomNavigation.visible)
                }
            }
            .ignoresSafeArea()
        }
        .statusBarHidden(systemChrome.immersivePlayback)
        .modifier(ConduitPersistentSystemOverlaysModifier(hidden: systemChrome.immersivePlayback))
    }
}

private struct ConduitSafeAreaProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> ConduitSafeAreaProbeView {
        ConduitSafeAreaProbeView()
    }

    func updateUIView(_ view: ConduitSafeAreaProbeView, context: Context) {}
}

private final class ConduitSafeAreaProbeView: UIView {
    override func didMoveToWindow() {
        super.didMoveToWindow()
        publishSafeArea()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        publishSafeArea()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        publishSafeArea()
    }

    private func publishSafeArea() {
        guard let window else { return }
        PlatformSafeArea.shared.publish(topInsetPt: Float(window.safeAreaInsets.top))
    }
}

private final class ConduitKeyboardCoordinator: NSObject {
    static let shared = ConduitKeyboardCoordinator()

    private var observers: [NSObjectProtocol] = []

    private override init() {
        super.init()
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIResponder.keyboardWillChangeFrameNotification,
            object: nil,
            queue: .main,
        ) { _ in
            PlatformKeyboard.shared.publish(visible: true)
        })
        observers.append(center.addObserver(
            forName: UIResponder.keyboardWillHideNotification,
            object: nil,
            queue: .main,
        ) { _ in
            PlatformKeyboard.shared.publish(visible: false)
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }
}

final class ConduitBottomNavigationCoordinator: NSObject, ObservableObject, IosBottomNavigationBridge {
    static let shared = ConduitBottomNavigationCoordinator()

    @Published private(set) var visible = false
    @Published private(set) var selectedIndex: Int = 0
    @Published private(set) var labels: [String] = []
    @Published private(set) var classic = false
    private var selectionHandler: IosBottomNavigationSelectionHandler?

    private override init() {}

    func update(
        visible: Bool,
        selectedIndex: Int32,
        labels: [String],
        classic: Bool,
        selectionHandler: IosBottomNavigationSelectionHandler?
    ) {
        let apply = { [weak self] in
            guard let self else { return }
            guard self.visible != visible ||
                self.selectedIndex != Int(selectedIndex) ||
                self.labels != labels ||
                self.classic != classic
            else { return }
            self.visible = visible
            self.selectedIndex = Int(selectedIndex)
            self.labels = labels
            self.classic = classic
            self.selectionHandler = selectionHandler
        }
        if Thread.isMainThread { apply() } else { DispatchQueue.main.async(execute: apply) }
    }

    fileprivate func select(_ index: Int) {
        selectionHandler?.select(index: Int32(index))
    }
}

/// Provides the native equivalent of Android's system back gesture for the
/// Compose screens that currently own a back action.
final class ConduitBackGestureCoordinator: NSObject, IosBackGestureBridge, UIGestureRecognizerDelegate {
    static let shared = ConduitBackGestureCoordinator()

    private var handler: IosBackGestureHandler?
    private weak var gestureView: UIView?
    private var edgeGesture: UIScreenEdgePanGestureRecognizer?
    private var activationObserver: NSObjectProtocol?
    private weak var snapshotHostView: UIView?
    private var interactiveSnapshot: UIView?
    private var interactiveHandler: IosBackGestureHandler?
    private var interactiveBackCommitted = false

    private override init() {
        super.init()
        activationObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.installGestureIfNeeded()
            self?.edgeGesture?.isEnabled = self?.handler != nil
        }
    }

    deinit {
        if let activationObserver {
            NotificationCenter.default.removeObserver(activationObserver)
        }
    }

    func update(handler: IosBackGestureHandler?) {
        let apply = { [weak self] in
            guard let self else { return }
            self.handler = handler
            self.installGestureIfNeeded()
            self.edgeGesture?.isEnabled = handler != nil
        }
        if Thread.isMainThread { apply() } else { DispatchQueue.main.async(execute: apply) }
    }

    private func installGestureIfNeeded() {
        guard edgeGesture == nil,
              let window = UIApplication.shared.connectedScenes
                  .compactMap({ $0 as? UIWindowScene })
                  .first(where: { $0.activationState == .foregroundActive })?
                  .windows
                  .first(where: \.isKeyWindow),
              let view = window.rootViewController?.view
        else { return }

        let gesture = UIScreenEdgePanGestureRecognizer(
            target: self,
            action: #selector(handleEdgePan(_:))
        )
        gesture.edges = .left
        gesture.delegate = self
        view.addGestureRecognizer(gesture)
        gestureView = view
        snapshotHostView = view.superview ?? window
        edgeGesture = gesture
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let edgeGesture else { return false }
        return gestureRecognizer === edgeGesture && handler != nil
    }

    @objc private func handleEdgePan(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard let view = gestureView else { return }
        let translation = max(0, gesture.translation(in: view).x)
        let threshold = max(80, view.bounds.width * 0.32)

        switch gesture.state {
        case .began:
            guard let handler,
                  let hostView = view.superview ?? self.snapshotHostView,
                  let snapshot = view.snapshotView(afterScreenUpdates: false)
            else { return }
            self.snapshotHostView = hostView
            snapshot.frame = hostView.convert(view.bounds, from: view)
            snapshot.autoresizingMask = []
            snapshot.layer.shadowColor = UIColor.black.cgColor
            snapshot.layer.shadowOpacity = 0.3
            snapshot.layer.shadowRadius = 18
            snapshot.layer.shadowOffset = CGSize(width: -8, height: 0)
            // UIHostingController rejects its snapshot replicant as a child.
            // Put the outgoing page above the hosting view in their common
            // superview so the newly-rendered destination can appear below it.
            hostView.addSubview(snapshot)
            interactiveSnapshot = snapshot
            interactiveHandler = handler
            interactiveBackCommitted = false
        case .changed:
            interactiveSnapshot?.transform = CGAffineTransform(
                translationX: min(translation, view.bounds.width),
                y: 0
            )
            if !interactiveBackCommitted &&
                (translation >= threshold || gesture.velocity(in: view).x >= 500)
            {
                interactiveBackCommitted = true
                interactiveHandler?.onBack()
            }
        case .ended:
            let shouldCommit = interactiveBackCommitted ||
                translation >= 80 ||
                gesture.velocity(in: view).x >= 500
            if shouldCommit && !interactiveBackCommitted {
                interactiveBackCommitted = true
                interactiveHandler?.onBack()
            }
            finishInteractiveBack(on: view, committed: shouldCommit)
        case .cancelled, .failed:
            finishInteractiveBack(on: view, committed: interactiveBackCommitted)
        default:
            break
        }
    }

    private func finishInteractiveBack(on view: UIView, committed: Bool) {
        guard let snapshot = interactiveSnapshot else {
            interactiveHandler = nil
            interactiveBackCommitted = false
            return
        }
        let targetX = committed ? view.bounds.width : 0
        let animate = { [weak self, weak snapshot] in
            self?.snapshotHostView?.layoutIfNeeded()
            UIView.animate(
                withDuration: committed ? 0.2 : 0.16,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction],
                animations: {
                    snapshot?.transform = CGAffineTransform(translationX: targetX, y: 0)
                },
                completion: { _ in
                    snapshot?.removeFromSuperview()
                    self?.interactiveSnapshot = nil
                    self?.interactiveHandler = nil
                    self?.interactiveBackCommitted = false
                }
            )
        }
        if committed {
            // Compose applies the back action on its next frame. Keep the
            // outgoing snapshot still until that destination is underneath it.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.06, execute: animate)
        } else {
            animate()
        }
    }
}

private struct ConduitBottomTabBar: UIViewRepresentable {
    @ObservedObject var coordinator: ConduitBottomNavigationCoordinator

    func makeCoordinator() -> Delegate {
        Delegate(owner: coordinator)
    }

    func makeUIView(context: Context) -> ConduitTabBarContainer {
        let tabBar = UITabBar()
        tabBar.delegate = context.coordinator
        tabBar.tintColor = UIColor(red: 0.98, green: 0.75, blue: 0.14, alpha: 1)
        tabBar.unselectedItemTintColor = UIColor.white.withAlphaComponent(0.55)
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(white: 0.07, alpha: 1)
        appearance.shadowColor = UIColor.white.withAlphaComponent(0.12)
        tabBar.standardAppearance = appearance
        if #available(iOS 15.0, *) {
            tabBar.scrollEdgeAppearance = appearance
        }
        tabBar.itemPositioning = .fill
        tabBar.layoutMargins = UIEdgeInsets(top: 5, left: 8, bottom: 5, right: 8)
        return ConduitTabBarContainer(tabBar: tabBar)
    }

    func updateUIView(_ container: ConduitTabBarContainer, context: Context) {
        context.coordinator.owner = coordinator
        let tabBar = container.tabBar
        tabBar.layoutMargins = UIEdgeInsets(
            top: 5,
            left: 8,
            bottom: 5,
            right: 8
        )
        let symbolConfiguration = UIImage.SymbolConfiguration(
            pointSize: 22,
            weight: .regular,
            scale: .medium
        )
        let items = coordinator.labels.enumerated().map { index, label in
            UITabBarItem(
                title: label,
                image: UIImage(
                    systemName: systemImageName(for: label),
                    withConfiguration: symbolConfiguration
                ),
                tag: index
            )
        }
        if tabBar.items?.count != items.count || tabBar.items?.map(\.title) != items.map(\.title) {
            tabBar.setItems(items, animated: false)
        } else {
            tabBar.items?.enumerated().forEach { index, item in
                item.title = items[index].title
            }
        }
        tabBar.selectedItem = tabBar.items?.first { $0.tag == coordinator.selectedIndex }
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

    final class Delegate: NSObject, UITabBarDelegate {
        var owner: ConduitBottomNavigationCoordinator

        init(owner: ConduitBottomNavigationCoordinator) {
            self.owner = owner
        }

        func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
            owner.select(item.tag)
        }
    }
}

private final class ConduitTabBarContainer: UIView {
    let tabBar: UITabBar

    init(tabBar: UITabBar) {
        self.tabBar = tabBar
        super.init(frame: .zero)
        backgroundColor = .clear
        isOpaque = false
        tabBar.backgroundColor = .clear
        tabBar.isOpaque = false
        tabBar.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        clipsToBounds = true
        addSubview(tabBar)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        tabBar.frame = bounds
        tabBar.setNeedsLayout()
        tabBar.layoutIfNeeded()
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
