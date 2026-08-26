import AVFoundation
import AVKit
import ComposeApp
import CoreText
import Foundation
import Libmpv
import UIKit

fileprivate struct ConduitSubtitle {
    let url: String
    let language: String
    let name: String?
}

private struct ConduitPendingLoad {
    let url: String
    let initialPositionMs: Int64
    let headers: [String: String]
    let subtitles: [ConduitSubtitle]
}

fileprivate struct ConduitTrack {
    let id: Int
    let title: String
    let language: String
    let codec: String
    let channels: String
    let channelCount: Int
    let sampleRate: Int
    let bitrate: Int64
    let external: Bool
    let selected: Bool
}

/// A visible surface is enough to begin loading. Orientation is managed by
/// the host separately and must not turn a pending playback request into a
/// load that only starts after a later touch-driven layout pass.
func shouldStartPendingLoad(surfaceSize: CGSize) -> Bool {
    surfaceSize.width > 1 && surfaceSize.height > 1
}

/// Applies the color metadata appropriate for libmpv's packed RGB software
/// output before it is handed to AVSampleBufferDisplayLayer.
enum ConduitSoftwarePixelBufferColorMetadata {
    static func apply(to pixelBuffer: CVPixelBuffer) {
        // The render API writes packed RGB. A YCbCr matrix describes a
        // YCbCr-to-RGB conversion and can make AVSampleBufferDisplayLayer
        // reinterpret high-contrast subtitle edges as colored fringes.
        CVBufferSetAttachment(
            pixelBuffer,
            kCVImageBufferColorPrimariesKey,
            kCVImageBufferColorPrimaries_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            pixelBuffer,
            kCVImageBufferTransferFunctionKey,
            kCVImageBufferTransferFunction_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            pixelBuffer,
            kCVImageBufferAlphaChannelIsOpaque,
            kCFBooleanTrue,
            .shouldPropagate
        )
    }
}

/// The packed format requested from libmpv must match the Core Video buffer
/// format allocated for the sample buffer.
enum ConduitSoftwarePixelBufferFormat {
    static let mpv = "bgra"
    static let coreVideo = kCVPixelFormatType_32BGRA
}

/// The Swift half of the Kotlin/iOS player boundary.
///
/// This follows the same shape as Nuvio's iOS integration: Compose owns the
/// screen and controls, while libmpv's software render API draws each frame
/// into a pixel buffer that feeds one AVSampleBufferDisplayLayer. That single
/// surface serves both inline display and PiP, so there is no Metal swapchain
/// and no second pipeline to keep in sync.
final class ConduitMPVPlayerBridge: NSObject, IosPlayerBridge {
    private var playerViewController: ConduitMPVPlayerViewController?
    private var holdsLandscapeLock = false
    private var playbackRegistered = true

    override init() {
        super.init()
        ConduitOrientationCoordinator.shared.beginPlayback()
    }

    func createPlayerViewController() -> UIViewController {
        if let playerViewController {
            return playerViewController
        }
        let controller = ConduitMPVPlayerViewController()
        playerViewController = controller
        return controller
    }

    func loadFile(
        url: String,
        initialPositionMs: Int64,
        headersJson: String?,
        subtitlesJson: String?
    ) {
        ensurePlayerViewController().loadFile(
            url,
            initialPositionMs: initialPositionMs,
            headers: parseHeaders(headersJson),
            subtitles: parseSubtitles(subtitlesJson)
        )
    }
    func updateExternalSubtitles(subtitlesJson: String) {
        ensurePlayerViewController().updateExternalSubtitles(parseSubtitles(subtitlesJson))
    }

    func play() { playerViewController?.playPlayback() }
    func pause() { playerViewController?.pausePlayback() }
    func seekTo(positionMs: Int64) { playerViewController?.seekToMs(positionMs) }
    func seekBy(offsetMs: Int64) { playerViewController?.seekByMs(offsetMs) }
    func setPlaybackSpeed(speed: Float) { playerViewController?.setSpeed(speed) }
    func setMuted(muted: Bool) { playerViewController?.setMuted(muted) }
    func setPreferredAudioLanguage(language: String) {
        ensurePlayerViewController().setPreferredAudioLanguage(language)
    }
    func setPreferredSubtitleLanguage(language: String) {
        ensurePlayerViewController().setPreferredSubtitleLanguage(language)
    }
    func setResizeMode(mode: Int32) { playerViewController?.setResize(Int(mode)) }
    func retryVideoOutput() { playerViewController?.retryVideoOutput() }
    func setImmersivePlayback(enabled: Bool) {
        if enabled && !holdsLandscapeLock {
            holdsLandscapeLock = true
            ConduitSystemChromeCoordinator.shared.beginImmersivePlayback()
            ConduitOrientationCoordinator.shared.beginLandscapeLock()
        } else if !enabled && holdsLandscapeLock {
            holdsLandscapeLock = false
            ConduitSystemChromeCoordinator.shared.endImmersivePlayback()
            ConduitOrientationCoordinator.shared.endLandscapeLock()
        }
    }
    func isPictureInPictureSupported() -> Bool {
        ensurePlayerViewController().isPictureInPictureSupported
    }
    func isPictureInPictureActive() -> Bool {
        playerViewController?.isPictureInPictureActive ?? false
    }
    func startPictureInPicture() { ensurePlayerViewController().startPictureInPicture() }
    func stopPictureInPicture() { playerViewController?.stopPictureInPicture() }
    func syncVideoSurfaceLayout(width: Double, height: Double) {
        ensurePlayerViewController().syncVideoSurfaceLayout(
            CGSize(width: width, height: height)
        )
    }
    func setInteractiveResize(active: Bool) {
        ensurePlayerViewController().setInteractiveResize(active)
    }

    func getAudioTrackCount() -> Int32 {
        Int32(playerViewController?.audioTracks.count ?? 0)
    }

    func getAudioTrackId(at: Int32) -> Int32 {
        guard let track = track(at: at, in: playerViewController?.audioTracks) else { return 0 }
        return Int32(track.id)
    }

    func getAudioTrackLabel(at: Int32) -> String {
        track(at: at, in: playerViewController?.audioTracks)?.title ?? ""
    }

    func getAudioTrackLang(at: Int32) -> String {
        track(at: at, in: playerViewController?.audioTracks)?.language ?? ""
    }

    func getAudioTrackLanguageName(at: Int32) -> String {
        guard let track = track(at: at, in: playerViewController?.audioTracks) else { return "" }
        let code = track.language.replacingOccurrences(of: "_", with: "-").split(separator: "-").first.map(String.init) ?? ""
        return Locale.current.localizedString(forLanguageCode: code)?.localizedCapitalized ?? ""
    }

    func getAudioTrackCodec(at: Int32) -> String {
        track(at: at, in: playerViewController?.audioTracks)?.codec ?? ""
    }

    func getAudioTrackChannels(at: Int32) -> String {
        track(at: at, in: playerViewController?.audioTracks)?.channels ?? ""
    }

    func getAudioTrackChannelCount(at: Int32) -> Int32 {
        Int32(track(at: at, in: playerViewController?.audioTracks)?.channelCount ?? 0)
    }

    func getAudioTrackSampleRate(at: Int32) -> Int32 {
        Int32(track(at: at, in: playerViewController?.audioTracks)?.sampleRate ?? 0)
    }

    func getAudioTrackBitrate(at: Int32) -> Int64 {
        track(at: at, in: playerViewController?.audioTracks)?.bitrate ?? 0
    }

    func isAudioTrackSelected(at: Int32) -> Bool {
        track(at: at, in: playerViewController?.audioTracks)?.selected ?? false
    }

    func getSubtitleTrackCount() -> Int32 {
        Int32(playerViewController?.subtitleTracks.count ?? 0)
    }

    func getSubtitleTrackId(at: Int32) -> Int32 {
        guard let track = track(at: at, in: playerViewController?.subtitleTracks) else { return 0 }
        return Int32(track.id)
    }

    func getSubtitleTrackLabel(at: Int32) -> String {
        track(at: at, in: playerViewController?.subtitleTracks)?.title ?? ""
    }

    func getSubtitleTrackLang(at: Int32) -> String {
        track(at: at, in: playerViewController?.subtitleTracks)?.language ?? ""
    }

    func getSubtitleTrackCodec(at: Int32) -> String {
        track(at: at, in: playerViewController?.subtitleTracks)?.codec ?? ""
    }

    func isSubtitleTrackExternal(at: Int32) -> Bool {
        track(at: at, in: playerViewController?.subtitleTracks)?.external ?? false
    }

    func isSubtitleTrackSelected(at: Int32) -> Bool {
        track(at: at, in: playerViewController?.subtitleTracks)?.selected ?? false
    }

    func selectAudioTrack(trackId: Int32) {
        playerViewController?.selectAudio(Int(trackId))
    }

    func selectSubtitleTrack(trackId: Int32) {
        playerViewController?.selectSubtitle(Int(trackId))
    }

    func getIsLoading() -> Bool {
        playerViewController?.refreshPlaybackState()
        return playerViewController?.isPlayerLoading ?? true
    }

    func getIsBuffering() -> Bool { playerViewController?.isPlayerBuffering ?? false }
    func getIsPlaying() -> Bool { playerViewController?.isPlayerPlaying ?? false }
    func getIsEnded() -> Bool { playerViewController?.isPlayerEnded ?? false }
    func getDurationMs() -> Int64 { playerViewController?.durationMs ?? 0 }
    func getPositionMs() -> Int64 { playerViewController?.positionMs ?? 0 }
    func getVideoWidth() -> Int32 { Int32(playerViewController?.videoWidth ?? 0) }
    func getVideoHeight() -> Int32 { Int32(playerViewController?.videoHeight ?? 0) }
    func getPlaybackSpeed() -> Float { playerViewController?.currentSpeed ?? 1.0 }
    func getErrorMessage() -> String { playerViewController?.currentErrorMessage ?? "" }

    func destroy() {
        let controller = playerViewController
        playerViewController = nil
        controller?.destroyPlayer()
        if holdsLandscapeLock {
            holdsLandscapeLock = false
            ConduitSystemChromeCoordinator.shared.endImmersivePlayback()
            ConduitOrientationCoordinator.shared.endLandscapeLock()
        }
        if playbackRegistered {
            playbackRegistered = false
            ConduitOrientationCoordinator.shared.endPlayback()
        }
    }

    private func ensurePlayerViewController() -> ConduitMPVPlayerViewController {
        if let playerViewController {
            return playerViewController
        }
        let controller = ConduitMPVPlayerViewController()
        playerViewController = controller
        return controller
    }

    private func track(at index: Int32, in tracks: [ConduitTrack]?) -> ConduitTrack? {
        guard let tracks, index >= 0, Int(index) < tracks.count else { return nil }
        return tracks[Int(index)]
    }

    private func parseHeaders(_ json: String?) -> [String: String] {
        guard
            let json,
            let data = json.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }

        return object.reduce(into: [:]) { result, entry in
            if let value = entry.value as? String {
                result[entry.key] = value
            }
        }
    }

    private func parseSubtitles(_ json: String?) -> [ConduitSubtitle] {
        guard
            let json,
            let data = json.data(using: .utf8),
            let objects = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }

        return objects.compactMap { object in
            guard let url = object["url"] as? String, !url.isEmpty else { return nil }
            return ConduitSubtitle(
                url: url,
                language: object["lang"] as? String ?? "",
                name: object["addonName"] as? String ?? object["id"] as? String
            )
        }
    }
}

final class ConduitMPVPlayerBridgeCreator: NSObject, IosPlayerBridgeCreator {
    func createBridge() -> any IosPlayerBridge {
        ConduitMPVPlayerBridge()
    }
}

enum ConduitPlayerRegistration {
    static func register() {
        IosPlayerBridgeFactory.shared.registerFactory(creator: ConduitMPVPlayerBridgeCreator())
    }
}

final class ConduitMPVPlayerViewController: UIViewController {
    private static let audioOutput = "audiounit"
    /// Long-side cap for the software render target. Bounds the per-frame CPU
    /// cost of the libmpv software renderer; the display layer upscales to the
    /// screen. PiP windows are far smaller than this budget.
    private static let maxRenderLongSide = 1440
    // Audio route changes can block. Serialize them across player instances
    // without making the Compose/UIKit thread wait for the system audio route.
    private static let audioSessionQueue = DispatchQueue(label: "media.conduit.audio-session", qos: .userInitiated)

    private let eventQueue = DispatchQueue(label: "media.conduit.mpv-events", qos: .userInitiated)
    private let subtitleQueue = DispatchQueue(label: "media.conduit.mpv-subtitles", qos: .utility)
    /// Serializes mpv_render_context_render calls and sample-buffer delivery.
    private let renderQueue = DispatchQueue(label: "media.conduit.mpv-render", qos: .userInitiated)
    private let subtitleLock = NSLock()
    private let errorLock = NSLock()
    fileprivate let pictureInPictureClock = ConduitPipPlaybackClock()
    /// The single video surface: rendered frames flow here for inline display,
    /// and AVKit mirrors this layer into the PiP window. One render path feeds
    /// both, so there is no second pipeline to keep in sync.
    fileprivate let displayLayer = AVSampleBufferDisplayLayer()
    private let pictureInPicturePlaceholderLayer = CALayer()
    private var pictureInPicture: ConduitPictureInPictureCoordinator?
    private lazy var subtitleFontController = ConduitSubtitleFontController()
    private var mpv: OpaquePointer?

    // MARK: Software renderer state (guarded by renderStateLock unless noted)
    private let renderStateLock = NSLock()
    private var renderContext: OpaquePointer?
    private var renderInProgress = false
    private var renderNeedsAnotherPass = false
    private var pixelBufferPool: CVPixelBufferPool?
    private var poolWidth = 0
    private var poolHeight = 0
    private var formatDescription: CMVideoFormatDescription?
    private var enqueuedFrameCount: UInt64 = 0

    private var pendingLoad: ConduitPendingLoad?
    private var pendingRetry: DispatchWorkItem?
    private var activeHeaders: [String: String] = [:]
    private var preferredAudioLanguage = "System default"
    private var preferredSubtitleLanguage = "English"
    private var preferredSubtitleApplied = false
    fileprivate var hasLoadedFile = false
    private var shouldPlay = false
    private var resumeAfterAudioInterruption = false
    private var videoTrackSuspendedForBackground = false
    private var videoSurfaceSize: CGSize = .zero
    private var externallyManagedViewSize: CGSize?
    private var pendingSurfaceLayoutWorkItems: [DispatchWorkItem] = []
    private var hasVideoStream = false
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var recentErrors: [String] = []
    private var playbackError: String?
    private var waitingForInitialVideoFrame = false
    private var pendingExternalSubtitles: [ConduitSubtitle] = []
    private var loadedExternalSubtitleURLs = Set<String>()
    private var subtitleLoadGeneration = 0
    private var loadStartedAtUptime: TimeInterval = 0
    private var destroyStarted = false
    private var audioSessionActivationRequested = false
    private var frameRateDisplayLink: CADisplayLink?
    fileprivate var resizeMode = 0
    private var automaticPipHomeSwipeCandidate = false
    private var automaticPipHomeSwipeEdge: AutomaticPipSwipeEdge?
    private var lastDebugPlaybackSnapshot: String?
    private var videoFrameRate = 30.0

    fileprivate var audioTracks: [ConduitTrack] = []
    fileprivate var subtitleTracks: [ConduitTrack] = []
    var isPlayerLoading = true
    var isPlayerBuffering = false
    var isPlayerPlaying = false
    var isPlayerEnded = false
    var durationMs: Int64 = 0
    var positionMs: Int64 = 0
    var videoWidth = 0
    var videoHeight = 0
    var currentSpeed: Float = 1.0

    var currentErrorMessage: String {
        errorLock.lock()
        defer { errorLock.unlock() }
        return playbackError ?? ""
    }

    override var canBecomeFirstResponder: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.bottom, .left, .right] }
    override var prefersStatusBarHidden: Bool { true }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.layer.masksToBounds = true

        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = UIColor.black.cgColor
        if #available(iOS 17.0, *) {
            displayLayer.wantsExtendedDynamicRangeContent = false
        }
        view.layer.addSublayer(displayLayer)
        pictureInPicturePlaceholderLayer.backgroundColor = UIColor.black.cgColor
        pictureInPicturePlaceholderLayer.opacity = 0
        view.layer.addSublayer(pictureInPicturePlaceholderLayer)
        pictureInPicture = ConduitPictureInPictureCoordinator(owner: self)

        setupMpv()
        configureAudioSession()
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pictureInPicture?.cancelAutomaticEntryIfForegrounded()
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.enterBackground() })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.enterForeground() })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            self?.handleAudioInterruption(notification)
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            self?.handleAudioRouteChange(notification)
        })

        let homeSwipeRecognizer = UIPanGestureRecognizer(
            target: self,
            action: #selector(handleAutomaticPipHomeSwipe(_:))
        )
        homeSwipeRecognizer.delegate = self
        homeSwipeRecognizer.cancelsTouchesInView = false
        view.addGestureRecognizer(homeSwipeRecognizer)
    }

    /// Detects the Home-transition swipe: up from the bottom edge in
    /// portrait, inward from the home-indicator side edge in landscape. The
    /// system defers these edges to this view, so the first swipe lands here
    /// and PiP can be started explicitly while the app is still active
    /// instead of relying on AVKit's inline trigger.
    @objc private func handleAutomaticPipHomeSwipe(_ recognizer: UIPanGestureRecognizer) {
        guard UIApplication.shared.applicationState == .active else { return }

        switch recognizer.state {
        case .began:
            automaticPipHomeSwipeEdge = homeIndicatorEdge(
                at: recognizer.location(in: view)
            )
            automaticPipHomeSwipeCandidate = automaticPipHomeSwipeEdge != nil
            debugLog("home swipe began edge=\(automaticPipHomeSwipeEdge.map(String.init(describing:)) ?? "none")")

        case .changed:
            guard automaticPipHomeSwipeCandidate,
                  let edge = automaticPipHomeSwipeEdge else { return }
            guard isInwardHomeSwipe(recognizer.translation(in: view), from: edge) else { return }
            debugLog("home swipe inward confirmed edge=\(edge)")
            automaticPipHomeSwipeCandidate = false
            automaticPipHomeSwipeEdge = nil
            pictureInPicture?.handleHomeSwipeDetected()

        case .ended, .cancelled, .failed:
            automaticPipHomeSwipeCandidate = false
            automaticPipHomeSwipeEdge = nil
            pictureInPicture?.scheduleAutomaticCancelIfAborted()

        default:
            break
        }
    }

    private enum AutomaticPipSwipeEdge {
        case bottom
        case left
        case right
    }

    /// The Home indicator sits on the bottom edge in portrait and on one
    /// side edge in landscape (right for landscapeLeft, left for
    /// landscapeRight).
    private func homeIndicatorEdge(at location: CGPoint) -> AutomaticPipSwipeEdge? {
        let activationDistance: CGFloat = 28.0
        let bounds = view.bounds
        switch view.window?.windowScene?.interfaceOrientation {
        case .landscapeLeft:
            return location.x >= bounds.maxX - activationDistance ? .right : nil
        case .landscapeRight:
            return location.x <= activationDistance ? .left : nil
        default:
            let activationHeight = max(activationDistance, view.safeAreaInsets.bottom + 10.0)
            return location.y >= bounds.maxY - activationHeight ? .bottom : nil
        }
    }

    private func isInwardHomeSwipe(
        _ translation: CGPoint,
        from edge: AutomaticPipSwipeEdge
    ) -> Bool {
        switch edge {
        case .bottom:
            return translation.y <= -18.0 && abs(translation.y) > abs(translation.x) * 1.15
        case .left:
            return translation.x >= 18.0 && abs(translation.x) > abs(translation.y) * 1.15
        case .right:
            return translation.x <= -18.0 && abs(translation.x) > abs(translation.y) * 1.15
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutDisplayLayer()
        pictureInPicturePlaceholderLayer.frame = view.bounds
        attemptStartPendingLoad()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
        syncVideoSurfaceLayout()
        attemptStartPendingLoad()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        syncVideoSurfaceLayout()
    }

    override func viewWillTransition(
        to size: CGSize,
        with coordinator: UIViewControllerTransitionCoordinator
    ) {
        super.viewWillTransition(to: size, with: coordinator)

        syncVideoSurfaceLayoutNow(scheduleDeferredPasses: false)
        coordinator.animate(alongsideTransition: { [weak self] _ in
            self?.syncVideoSurfaceLayoutNow(scheduleDeferredPasses: false)
        }, completion: { [weak self] _ in
            self?.syncVideoSurfaceLayout()
            self?.attemptStartPendingLoad()
        })
    }

    func syncVideoSurfaceLayout(_ size: CGSize) {
        runOnMain { [weak self] in
            self?.syncVideoSurfaceLayoutNow(size: size, scheduleDeferredPasses: true)
        }
    }

    private func syncVideoSurfaceLayout() {
        syncVideoSurfaceLayoutNow(scheduleDeferredPasses: true)
    }

    /// The software render target follows the surface every frame, so pinch
    /// resizes need no swapchain protection; kept as a no-op for the shared
    /// player contract.
    func setInteractiveResize(_ active: Bool) {}

    fileprivate func loadFile(
        _ url: String,
        initialPositionMs: Int64,
        headers: [String: String],
        subtitles: [ConduitSubtitle]
    ) {
        let request = ConduitPendingLoad(
            url: url,
            initialPositionMs: max(0, initialPositionMs),
            headers: headers,
            subtitles: subtitles
        )

        let prepareLoad = { [weak self] in
            guard let self else { return }
            self.pendingLoad = request
            guard let pictureInPicture = self.pictureInPicture else {
                self.attemptStartPendingLoad()
                return
            }
            pictureInPicture.stopForNewLoad { [weak self] in
                self?.attemptStartPendingLoad()
            }
        }

        if Thread.isMainThread {
            prepareLoad()
        } else {
            DispatchQueue.main.async(execute: prepareLoad)
        }
    }

    fileprivate func updateExternalSubtitles(_ subtitles: [ConduitSubtitle]) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            self.pendingExternalSubtitles = subtitles
            if self.hasLoadedFile && !self.waitingForInitialVideoFrame {
                self.loadPendingExternalSubtitles()
            }
        }
    }

    func playPlayback() {
        runOnMain { [weak self] in
            guard let self else { return }
            self.debugLog("playback command=play source=app-or-pip")
            self.shouldPlay = true
            guard self.mpv != nil else { return }
            // Claim the session before the first-frame gate: activation is
            // idempotent, and waiting would leave mpv's AudioUnit init as the
            // de facto owner of the shared session.
            self.activateAudioSession()
            guard !self.waitingForInitialVideoFrame else { return }
            self.setFlag("pause", false)
            self.isPlayerPlaying = true
            self.refreshPlaybackState()
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func pausePlayback() {
        runOnMain { [weak self] in
            guard let self else { return }
            self.debugLog("playback command=pause source=app-or-pip")
            self.shouldPlay = false
            guard self.mpv != nil else { return }
            self.setFlag("pause", true)
            self.isPlayerPlaying = false
            self.refreshPlaybackState()
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func seekToMs(_ milliseconds: Int64) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            self.pictureInPictureClock.reset(positionMs: milliseconds)
            self.pictureInPicture?.timelineDidSeek()
            self.command("seek", args: [String(format: "%.3f", Double(milliseconds) / 1000.0), "absolute"])
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func seekByMs(_ milliseconds: Int64) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            self.pictureInPictureClock.reset(positionMs: self.positionMs + milliseconds)
            self.pictureInPicture?.timelineDidSeek()
            self.command("seek", args: [String(format: "%.3f", Double(milliseconds) / 1000.0), "relative"])
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func setSpeed(_ speed: Float) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            var value = Double(speed).clamped(to: 0.25...4.0)
            checkError(mpv_set_property(self.mpv, "speed", MPV_FORMAT_DOUBLE, &value))
            self.currentSpeed = Float(value)
        }
    }

    func setMuted(_ muted: Bool) {
        runOnMain { [weak self] in
            self?.setFlag("mute", muted)
        }
    }

    func setPreferredAudioLanguage(_ language: String) {
        runOnMain { [weak self] in
            guard let self else { return }
            self.preferredAudioLanguage = language
            self.applyPreferredAudioLanguage()
        }
    }

    func setPreferredSubtitleLanguage(_ language: String) {
        runOnMain { [weak self] in
            guard let self else { return }
            guard self.preferredSubtitleLanguage != language else { return }
            self.preferredSubtitleLanguage = language
            self.preferredSubtitleApplied = false
            self.applyPreferredSubtitleSelection()
        }
    }

    func setResize(_ mode: Int) {
        runOnMain { [weak self] in
            guard let self else { return }
            self.resizeMode = mode
            guard self.mpv != nil else { return }
            switch mode {
            case 1, 2:
                self.setStringProperty("keepaspect", "yes")
                self.setStringProperty("panscan", "1.0")
                self.setStringProperty("video-aspect-override", "no")
                self.setStringProperty("video-zoom", mode == 2 ? "0.15" : "0.0")
            case 3:
                self.setStringProperty("keepaspect", "no")
                self.setStringProperty("panscan", "0.0")
                self.setStringProperty("video-aspect-override", "no")
                self.setStringProperty("video-zoom", "0.0")
            default:
                self.setStringProperty("keepaspect", "yes")
                self.setStringProperty("panscan", "0.0")
                self.setStringProperty("video-aspect-override", "no")
                self.setStringProperty("video-zoom", "0.0")
            }
            self.setStringProperty("video-unscaled", "no")
            // Fill/Zoom change which aspect the render target follows.
            self.updateRenderTarget()
            self.updateSubtitlePosition()
        }
    }

    func retryVideoOutput() {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            self.debugLog("retry video output requested")
            self.clearError()
            self.kickRender()
            self.refreshPlaybackState()
        }
    }

    func selectAudio(_ trackId: Int) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            var id = Int64(trackId)
            checkError(mpv_set_property(self.mpv, "aid", MPV_FORMAT_INT64, &id))
        }
    }

    func selectSubtitle(_ trackId: Int) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            // Manual choices must win over the initial preferred-language pass.
            self.preferredSubtitleApplied = true
            if trackId < 0 {
                self.setStringProperty("sid", "no")
            } else {
                var id = Int64(trackId)
                checkError(mpv_set_property(self.mpv, "sid", MPV_FORMAT_INT64, &id))
            }
            self.refreshTracks()
        }
    }

    func refreshPlaybackState() {
        guard let mpv else { return }
        let hasInitialVideoOutput = getString("video-frame-info/picture-type") != nil
            || getString("video-out-params/pixelformat") != nil
        if waitingForInitialVideoFrame, hasLoadedFile, hasInitialVideoOutput {
            waitingForInitialVideoFrame = false
#if DEBUG
            let elapsed = ProcessInfo.processInfo.systemUptime - loadStartedAtUptime
            print(String(format: "[Conduit MPV][startup] first video frame in %.2fs", elapsed))
#endif
            loadPendingExternalSubtitles()
            if shouldPlay { setFlag("pause", false) }
            kickRender()
        }
        let duration = getDouble("duration")
        let position = getDouble("time-pos")
        let speed = getDouble("speed")
        let paused = getFlag("pause")
        let eofReached = getFlag("eof-reached")
        let idle = getFlag("core-idle")
        let seeking = getFlag("seeking")
        let buffering = getFlag("paused-for-cache")
        let videoCodec = getString("video-codec")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let activeFrameRate = getDouble("video-params/fps")
        let containerFrameRate = getDouble("container-fps")
        // Display dimensions account for sample aspect ratio and rotation, so
        // PiP cropping and subtitle positioning see the picture viewers see
        // rather than the storage grid.
        var displayWidth = getInt("video-out-params/dw")
        var displayHeight = getInt("video-out-params/dh")
        if displayWidth <= 0 || displayHeight <= 0 {
            displayWidth = getInt("video-out-params/w")
            displayHeight = getInt("video-out-params/h")
        }
        if displayWidth <= 0 || displayHeight <= 0 {
            displayWidth = getInt("video-params/w")
            displayHeight = getInt("video-params/h")
        }
        let decodedWidth = displayWidth
        let decodedHeight = displayHeight
        let nextVideoWidth = max(decodedWidth, 0)
        let nextVideoHeight = max(decodedHeight, 0)
        let videoSizeChanged = videoWidth != nextVideoWidth || videoHeight != nextVideoHeight
        if !videoCodec.isEmpty { hasVideoStream = true }

        _ = mpv
        let mediaBuffering = buffering || seeking
        isPlayerBuffering = hasLoadedFile
            && !waitingForInitialVideoFrame
            && shouldPlay
            && !paused
            && !eofReached
            && mediaBuffering
        isPlayerLoading = waitingForInitialVideoFrame || !hasLoadedFile

        // `core-idle` and `paused-for-cache` describe MPV's temporary ability
        // to advance, not the user's play/pause intent. Keeping the UI in the
        // playing state lets MPV resume itself after the cache refills and
        // prevents a Play tap from fighting that automatic resume. Only the
        // explicit cache and seek flags drive the buffering overlay above.
        isPlayerPlaying = hasLoadedFile
            && !waitingForInitialVideoFrame
            && shouldPlay
            && !paused
            && !eofReached
        isPlayerEnded = eofReached
        durationMs = Int64(max(duration, 0) * 1000)
        positionMs = Int64(max(position, 0) * 1000)
        videoWidth = nextVideoWidth
        videoHeight = nextVideoHeight
        currentSpeed = Float(speed > 0 ? speed : 1.0)
        videoFrameRate = activeFrameRate > 0 ? activeFrameRate : (
            containerFrameRate > 0 ? containerFrameRate : 30
        )
        pictureInPictureClock.update(
            positionMs: positionMs,
            durationMs: durationMs,
            isPlaying: isPlayerPlaying,
            playbackRate: Double(currentSpeed),
            videoFrameRate: videoFrameRate
        )
        if videoSizeChanged {
            // The render target follows the video aspect in Fit mode.
            updateRenderTarget()
            updateSubtitlePosition()
        }
#if DEBUG
        debugPlaybackState(
            position: position,
            paused: paused,
            cachePaused: buffering,
            coreIdle: idle,
            seeking: seeking
        )
#endif
    }

    fileprivate var videoContentSize: CGSize {
        CGSize(width: max(videoWidth, 0), height: max(videoHeight, 0))
    }

    var isPictureInPictureSupported: Bool {
        pictureInPicture?.isSupported == true
    }

    var isPictureInPictureActive: Bool {
        pictureInPicture?.isActive == true
    }

    func startPictureInPicture() {
        pictureInPicture?.start()
    }

    func stopPictureInPicture() {
        pictureInPicture?.stop()
    }

    func destroyPlayer() {
        if !Thread.isMainThread {
            DispatchQueue.main.sync { [weak self] in self?.destroyPlayer() }
            return
        }

        guard !destroyStarted else { return }
        destroyStarted = true
        debugLog(
            "destroy player id=\(ObjectIdentifier(self)) subtitleGeneration=\(subtitleLoadGeneration) " +
            "pendingSubtitles=\(pendingExternalSubtitles.count)"
        )

        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        lifecycleObservers.removeAll()
        frameRateDisplayLink?.invalidate()
        frameRateDisplayLink = nil
        pendingRetry?.cancel()
        pendingRetry = nil
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll()
        pendingLoad = nil
        shouldPlay = false
        let pictureInPictureCoordinator = pictureInPicture
        deactivateAudioSession()

        guard let context = mpv else {
            pictureInPictureCoordinator?.invalidate()
            pictureInPicture = nil
            teardownRenderContext()
            return
        }
        mpv = nil
        invalidateExternalSubtitleLoads()

        let terminateMpv = { [self] in
            // All wakeup callbacks enqueue work on these queues. Drain them
            // before terminating libmpv, but keep the wait and teardown off
            // the main thread so leaving the player can update the UI
            // immediately. The render queue drains last: no render may touch
            // the context after it is freed.
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                subtitleQueue.sync {}
                eventQueue.sync {}
                renderQueue.sync {}
                teardownRenderContext()
                mpv_terminate_destroy(context)
            }
        }
        if let pictureInPictureCoordinator {
            pictureInPictureCoordinator.invalidate(completion: terminateMpv)
        } else {
            terminateMpv()
        }
        pictureInPicture = nil
    }

    private func teardownRenderContext() {
        renderStateLock.lock()
        let context = renderContext
        renderContext = nil
        pixelBufferPool = nil
        poolWidth = 0
        poolHeight = 0
        formatDescription = nil
        renderStateLock.unlock()
        guard let context else { return }
        mpv_render_context_set_update_callback(context, nil, nil)
        mpv_render_context_free(context)
    }

    deinit {
        destroyPlayer()
    }

    private func enterBackground() {
        guard mpv != nil else { return }
        // The PiP coordinator decides whether this backgrounding keeps the
        // primary pipeline alive (PiP active or a start in flight) or
        // suspends the video track (no accepted PiP transition).
        pictureInPicture?.handleEnterBackground()
    }

    private func enterForeground() {
        guard mpv != nil else { return }
        pictureInPicture?.handleEnterForeground()
        syncVideoSurfaceLayout()
        attemptStartPendingLoad()
    }

    /// Suspends MPV's video track once the app is truly backgrounded without
    /// an accepted PiP transition. VideoToolbox keeps decoding otherwise and
    /// can hold the decoder open indefinitely.
    fileprivate func suspendVideoTrackForBackground(reason: String) {
        guard UIApplication.shared.applicationState == .background else {
            debugLog("ignoring video-track suspension while not background reason=\(reason)")
            return
        }
        pausePlayback()
        // Release the audio session alongside the video track. Holding an
        // active .playback claim across suspension is what wedges other
        // apps' audio on iPadOS until a reboot; playPlayback re-activates.
        deactivateAudioSession()
        guard !videoTrackSuspendedForBackground else { return }
        setStringProperty("vid", "no")
        videoTrackSuspendedForBackground = true
        debugLog("video track suspended for background reason=\(reason)")
    }

    fileprivate func restoreVideoTrackAfterBackgroundIfNeeded(reloadDecoder: Bool = true) {
        guard videoTrackSuspendedForBackground, !destroyStarted else { return }
        videoTrackSuspendedForBackground = false
        setStringProperty("vid", "auto")
        if reloadDecoder {
            command("video-reload", checkForErrors: false)
        }
        debugLog("video track restored after background reloadDecoder=\(reloadDecoder)")
    }

    private func handleAudioInterruption(_ notification: Notification) {
        guard
            let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType)
        else { return }

        debugLog(
            "audio interruption type=\(type.rawValue) \(Self.audioSessionDescription(AVAudioSession.sharedInstance()))"
        )

        switch type {
        case .began:
            audioSessionActivationRequested = false
            resumeAfterAudioInterruption = shouldPlay || isPlayerPlaying
            pausePlayback()
        case .ended:
            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            if resumeAfterAudioInterruption && options.contains(.shouldResume) {
                playPlayback()
            }
            resumeAfterAudioInterruption = false
        @unknown default:
            resumeAfterAudioInterruption = false
        }
    }

    private func handleAudioRouteChange(_ notification: Notification) {
        let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason)?.rawValue ?? rawReason
        debugLog(
            "audio route changed reason=\(reason) \(Self.audioSessionDescription(AVAudioSession.sharedInstance()))"
        )
    }

    // MARK: - Display surface and software renderer

    /// Sizes the display layer to the view. The render target is independent
    /// of screen scale: it follows the picture aspect (or the surface aspect
    /// in Fill/Zoom) capped at maxRenderLongSide, and the layer upscales it.
    private func layoutDisplayLayer() {
        guard !destroyStarted, isViewLoaded else { return }
        let bounds = CGRect(origin: .zero, size: view.bounds.size)
        guard bounds.width > 1, bounds.height > 1 else { return }
        if videoSurfaceSize != bounds.size {
            videoSurfaceSize = bounds.size
            updateSubtitlePosition()
            updateRenderTarget()
        }

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        displayLayer.frame = bounds
        CATransaction.commit()
    }

    private func syncVideoSurfaceLayoutNow(
        size: CGSize? = nil,
        scheduleDeferredPasses: Bool
    ) {
        guard isViewLoaded, !destroyStarted else { return }
        if let size, size.width > 1, size.height > 1 {
            externallyManagedViewSize = size
            videoSurfaceSize = size
        } else if view.bounds.width > 1, view.bounds.height > 1 {
            videoSurfaceSize = view.bounds.size
        }
        updateSubtitlePosition()
        updateRenderTarget()
        // Compose owns the embedded controller's view geometry. Forcing its
        // frame or an immediate UIKit layout here can recursively lay out
        // Compose's hidden input view while the app is entering the foreground.
        view.setNeedsLayout()
        layoutDisplayLayer()

        guard scheduleDeferredPasses else { return }
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll(keepingCapacity: true)
        [0.0, 0.05, 0.15, 0.35].forEach { delay in
            let workItem = DispatchWorkItem { [weak self] in
                self?.layoutDisplayLayer()
            }
            pendingSurfaceLayoutWorkItems.append(workItem)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
        }
    }

    /// Recomputes the pixel-buffer dimensions on the render queue. A size
    /// change recreates the pool and the format description before the next
    /// frame renders, so buffers never mix dimensions.
    fileprivate func updateRenderTarget() {
        let surface = videoSurfaceSize
        let video = videoContentSize
        runOnRenderQueue { [weak self] in
            self?.applyRenderTarget(
                surfaceWidth: surface.width,
                surfaceHeight: surface.height,
                videoWidth: Double(video.width),
                videoHeight: Double(video.height)
            )
        }
    }

    private func applyRenderTarget(surfaceWidth: Double, surfaceHeight: Double, videoWidth: Double, videoHeight: Double) {
        let fills = resizeMode == 1 || resizeMode == 2
        switch ConduitRenderSizePolicy.decision(
            surfaceWidth: surfaceWidth,
            surfaceHeight: surfaceHeight,
            videoWidth: videoWidth,
            videoHeight: videoHeight,
            videoFillsSurface: fills,
            maxLongSide: Self.maxRenderLongSide
        ) {
        case .size(let width, let height):
            setPixelBufferPoolSize(width: width, height: height)
        case .skip:
            break
        }
    }

    /// Nudges the renderer even when mpv reports no new frame (retry button,
    /// first-frame edge cases). Harmless when a frame arrives anyway.
    fileprivate func kickRender() {
        scheduleRender()
    }

    private func setupRenderContext() {
        guard let mpv else { return }
        let api = UnsafeMutableRawPointer(mutating: (MPV_RENDER_API_TYPE_SW as NSString).utf8String)
        var params = [
            mpv_render_param(type: MPV_RENDER_PARAM_API_TYPE, data: api),
            mpv_render_param()
        ]
        var context: OpaquePointer?
        guard mpv_render_context_create(&context, mpv, &params) >= 0, let context else {
            print("[Conduit MPV] Software render context unavailable")
            return
        }
        renderStateLock.lock()
        renderContext = context
        renderStateLock.unlock()

        mpv_render_context_set_update_callback(
            context,
            { rawContext in
                guard let rawContext else { return }
                let controller = Unmanaged<ConduitMPVPlayerViewController>
                    .fromOpaque(rawContext)
                    .takeUnretainedValue()
                controller.scheduleRender()
            },
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    /// Coalesces render requests: at most one render in flight, with a
    /// follow-up pass whenever updates arrive while one is running.
    fileprivate func scheduleRender() {
        renderStateLock.lock()
        guard renderContext != nil else {
            renderStateLock.unlock()
            return
        }
        renderNeedsAnotherPass = true
        guard !renderInProgress else {
            renderStateLock.unlock()
            return
        }
        renderInProgress = true
        renderNeedsAnotherPass = false
        renderStateLock.unlock()

        renderQueue.async { [weak self] in
            self?.performRender()
        }
    }

    private func performRender() {
        defer {
            let shouldContinue: Bool
            renderStateLock.lock()
            shouldContinue = renderNeedsAnotherPass
            renderNeedsAnotherPass = false
            renderInProgress = false
            renderStateLock.unlock()
            if shouldContinue {
                scheduleRender()
            }
        }

        renderStateLock.lock()
        let context = renderContext
        let width = poolWidth
        let height = poolHeight
        renderStateLock.unlock()
        guard let context, width > 1, height > 1 else { return }

        let updateFlags = mpv_render_context_update(context)
        guard updateFlags & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 else { return }
        guard let pixelBuffer = makeRenderPixelBuffer(width: width, height: height) else { return }

        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }

        var size = [Int32(width), Int32(height)]
        var stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
        var blockForTargetTime: CInt = 0
        var format = UnsafeMutableRawPointer(
            mutating: (ConduitSoftwarePixelBufferFormat.mpv as NSString).utf8String
        )
        size.withUnsafeMutableBufferPointer { sizePtr in
            withUnsafeMutablePointer(to: &stride) { stridePtr in
                withUnsafeMutablePointer(to: &blockForTargetTime) { blockPtr in
                    var params = [
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_SIZE, data: sizePtr.baseAddress),
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_FORMAT, data: format),
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_STRIDE, data: stridePtr),
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_POINTER, data: baseAddress),
                        mpv_render_param(type: MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, data: blockPtr),
                        mpv_render_param()
                    ]
                    _ = mpv_render_context_render(context, &params)
                }
            }
        }

        enqueueFrame(pixelBuffer)
    }

    private func runOnRenderQueue(_ action: @escaping () -> Void) {
        renderQueue.async(execute: action)
    }

    private func setPixelBufferPoolSize(width: Int, height: Int) {
        renderStateLock.lock()
        if poolWidth == width, poolHeight == height, pixelBufferPool != nil {
            renderStateLock.unlock()
            return
        }
        poolWidth = width
        poolHeight = height
        formatDescription = nil
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: ConduitSoftwarePixelBufferFormat.coreVideo,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
            kCVPixelBufferCGImageCompatibilityKey: true,
        ]
        var pool: CVPixelBufferPool?
        let poolAttributes: [CFString: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey: 4,
        ]
        if CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            poolAttributes as CFDictionary,
            attributes as CFDictionary,
            &pool
        ) == kCVReturnSuccess {
            pixelBufferPool = pool
        } else {
            pixelBufferPool = nil
            print("[Conduit MPV] pixel buffer pool creation failed \(width)x\(height)")
        }
        renderStateLock.unlock()

        // Drop the stale last frame rather than stretching old-size content.
        flushDisplayLayer(removeImage: true)
    }

    private func makeRenderPixelBuffer(width: Int, height: Int) -> CVPixelBuffer? {
        renderStateLock.lock()
        let pool = pixelBufferPool
        let matchesPool = poolWidth == width && poolHeight == height
        renderStateLock.unlock()
        guard let pool, matchesPool else { return nil }
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess else {
            return nil
        }
        return pixelBuffer
    }

    /// Hands a freshly rendered buffer to AVKit. The PTS comes from the
    /// interpolated playback clock, and DisplayImmediately shows each sample
    /// on arrival; both inline and the PiP window read this same layer.
    private func enqueueFrame(_ pixelBuffer: CVPixelBuffer) {
        attachColorAttributes(to: pixelBuffer)

        renderStateLock.lock()
        var description = formatDescription
        if description == nil ||
            !CMVideoFormatDescriptionMatchesImageBuffer(description!, imageBuffer: pixelBuffer) {
            var created: CMVideoFormatDescription?
            CMVideoFormatDescriptionCreateForImageBuffer(
                allocator: kCFAllocatorDefault,
                imageBuffer: pixelBuffer,
                formatDescriptionOut: &created
            )
            formatDescription = created
            description = created
        }
        enqueuedFrameCount &+= 1
        renderStateLock.unlock()

        guard let description else { return }
        let clock = pictureInPictureClock.snapshot()
        let ptsSeconds = clock.interpolatedPositionSeconds(at: ProcessInfo.processInfo.systemUptime)
        let presentationTime = CMTime(seconds: max(ptsSeconds, 0), preferredTimescale: 90_000)
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: Int32(max(12.0, clock.videoFrameRate))),
            presentationTimeStamp: presentationTime,
            decodeTimeStamp: .invalid
        )

        var sampleBuffer: CMSampleBuffer?
        let status = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: description,
            sampleTiming: &timing,
            sampleBufferOut: &sampleBuffer
        )
        guard status == noErr, let sampleBuffer else { return }

        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true),
           CFArrayGetCount(attachments) > 0 {
            let dictionary = unsafeBitCast(
                CFArrayGetValueAtIndex(attachments, 0),
                to: CFMutableDictionary.self
            )
            CFDictionarySetValue(
                dictionary,
                Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
            )
        }

        deliverSample(sampleBuffer)
    }

    private func deliverSample(_ sampleBuffer: CMSampleBuffer) {
        if displayLayer.status == .failed {
            flushDisplayLayer(removeImage: true)
        }

        if #available(iOS 18.0, *) {
            let renderer = displayLayer.sampleBufferRenderer
            guard renderer.isReadyForMoreMediaData else { return }
            renderer.enqueue(sampleBuffer)
        } else {
            guard displayLayer.isReadyForMoreMediaData else { return }
            displayLayer.enqueue(sampleBuffer)
        }
    }

    fileprivate func flushDisplayLayer(removeImage: Bool) {
        let flush = {
            if #available(iOS 18.0, *) {
                self.displayLayer.sampleBufferRenderer.flush(
                    removingDisplayedImage: removeImage,
                    completionHandler: nil
                )
            } else if removeImage {
                self.displayLayer.flushAndRemoveImage()
            } else {
                self.displayLayer.flush()
            }
        }
        if Thread.isMainThread {
            flush()
        } else {
            DispatchQueue.main.async(execute: flush)
        }
    }

    /// SDR color tags for the software-rendered buffers. The SW path outputs
    /// standard dynamic range only.
    private func attachColorAttributes(to pixelBuffer: CVPixelBuffer) {
        ConduitSoftwarePixelBufferColorMetadata.apply(to: pixelBuffer)
    }

    /// Covers the video surface while PiP owns the picture. The layer itself
    /// keeps receiving rendered frames either way - it is the PiP source, so
    /// nothing here may stop or starve it. Releasing the refresh-rate pump
    /// removes the forced max-refresh scene churn while PiP floats over the
    /// app; playback pacing is unaffected because sample delivery paces
    /// itself off MPV's frame updates.
    fileprivate func setInlineVideoHiddenForPictureInPicture(_ hidden: Bool) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        pictureInPicturePlaceholderLayer.opacity = hidden ? 1 : 0
        CATransaction.commit()
        if hidden {
            frameRateDisplayLink?.invalidate()
            frameRateDisplayLink = nil
        } else {
            applyPreferredRefreshRate()
        }
    }

    private func setupMpv() {
        mpv = mpv_create()
        guard let mpv else {
            recordError("Unable to create the MPVKit player.")
            return
        }

#if DEBUG
        checkError(mpv_request_log_messages(mpv, "info"))
#else
        checkError(mpv_request_log_messages(mpv, "warn"))
#endif
        // vo=libmpv hands rendering to this app: the software render API draws
        // each frame into a pixel buffer that feeds one AVSampleBufferDisplayLayer
        // for both inline display and PiP. There is no Metal swapchain, so none
        // of the MoltenVK present/rebuild hazards apply.
        setOptionString(mpv, name: "vo", value: "libmpv")
#if targetEnvironment(simulator)
        // VideoToolbox in the simulator can report success without producing
        // displayable frames. Software decoding still exercises the real
        // decode-and-render path used by the app.
        setOptionString(mpv, name: "hwdec", value: "no")
#else
        setOptionString(mpv, name: "hwdec", value: "videotoolbox")
        setOptionString(mpv, name: "hwdec-software-fallback", value: "yes")
#endif
        setOptionString(mpv, name: "ao", value: Self.audioOutput)
        setOptionString(mpv, name: "audio-channels", value: "auto")
        setOptionString(mpv, name: "audio-fallback-to-null", value: "yes")
        // Default sync compensation duplicates/truncates audio fragments when
        // video timing wobbles. Resampling shifts speed by fractions of a
        // percent instead and is imperceptible.
        setOptionString(mpv, name: "audio-sync", value: "resample")
        setOptionString(mpv, name: "video-rotate", value: "no")
        setOptionString(mpv, name: "input-default-bindings", value: "no")
        setOptionString(mpv, name: "input-vo-keyboard", value: "no")
        setOptionString(mpv, name: "osc", value: "no")
        setOptionString(mpv, name: "keep-open", value: "yes")
        setOptionString(mpv, name: "subs-match-os-language", value: "yes")
        setOptionString(mpv, name: "subs-fallback", value: "yes")
        subtitleFontController.applySetupOptions { [weak self] name, value in
            self?.setOptionString(mpv, name: name, value: value)
        }

        let initializeStatus = mpv_initialize(mpv)
        checkError(initializeStatus)
        guard initializeStatus >= 0 else { return }
        setupRenderContext()
        applyPreferredAudioLanguage()

        for (index, property) in [
            (1, "pause"),
            (2, "paused-for-cache"),
            (3, "core-idle"),
            (4, "eof-reached"),
            (5, "seeking"),
            (6, "track-list/count"),
            (7, "sid"),
        ] {
            let format = property == "track-list/count" || property == "sid"
                ? MPV_FORMAT_INT64
                : MPV_FORMAT_FLAG
            mpv_observe_property(mpv, UInt64(index), property, format)
        }

        mpv_set_wakeup_callback(
            mpv,
            { context in
                guard let context else { return }
                let controller = Unmanaged<ConduitMPVPlayerViewController>
                    .fromOpaque(context)
                    .takeUnretainedValue()
                controller.readEvents()
            },
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    private func setOptionString(_ mpv: OpaquePointer, name: String, value: String) {
        let status = mpv_set_option_string(mpv, name, value)
        if status < 0 {
            print("[Conduit MPV] option \(name)=\(value) failed: \(String(cString: mpv_error_string(status)))")
        }
    }

    private func attemptStartPendingLoad() {
        guard let request = pendingLoad, mpv != nil else { return }
        guard viewIfLoaded?.window != nil else {
            schedulePendingRetry()
            return
        }

        let surfaceSize = externallyManagedViewSize ?? view.bounds.size
        guard shouldStartPendingLoad(surfaceSize: surfaceSize) else {
            schedulePendingRetry()
            return
        }

        layoutDisplayLayer()
        pendingLoad = nil
        pendingRetry?.cancel()
        pendingRetry = nil
        startLoad(request)
    }

    private func startLoad(_ request: ConduitPendingLoad) {
        guard mpv != nil else { return }
        debugLog(
            "start load id=\(ObjectIdentifier(self)) " +
            "externalSubtitles=\(request.subtitles.count)"
        )
        layoutDisplayLayer()
        pictureInPictureClock.reset(positionMs: request.initialPositionMs)
        clearError()
        activeHeaders = sanitizeHeaders(request.headers)
        applyRequestHeaders(activeHeaders)
        hasLoadedFile = false
        hasVideoStream = false
        isPlayerLoading = true
        isPlayerEnded = false
        waitingForInitialVideoFrame = true
        loadedExternalSubtitleURLs.removeAll(keepingCapacity: true)
        preferredSubtitleApplied = false
        pendingExternalSubtitles = request.subtitles
        invalidateExternalSubtitleLoads(clearPending: false)
        loadStartedAtUptime = ProcessInfo.processInfo.systemUptime
#if DEBUG
        print("[Conduit MPV][startup] opening stream")
#endif

        // Start paused at the resume timestamp. MPV can decode and present the
        // first video frame before audio begins, avoiding a visible late seek.
        var fileOptions = ["pause=yes"]
        if request.initialPositionMs > 0 {
            fileOptions.append(
                String(format: "start=%.3f", Double(request.initialPositionMs) / 1000.0)
            )
        }
        command(
            "loadfile",
            args: [request.url, "replace", "-1", fileOptions.joined(separator: ",")]
        )

    }

    private func schedulePendingRetry() {
        guard pendingRetry == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            self?.pendingRetry = nil
            self?.attemptStartPendingLoad()
        }
        pendingRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: work)
    }

    private func addSubtitle(_ subtitle: ConduitSubtitle) {
        guard mpv != nil else { return }
        command(
            "sub-add",
            args: [subtitle.url, "auto", subtitle.name ?? subtitle.language, subtitle.language],
            checkForErrors: false
        )
    }

    /// External subtitle URLs can take seconds each to open. Loading them only
    /// after video startup keeps them off the first-frame path and off the UI thread.
    private func loadPendingExternalSubtitles() {
        let subtitles = pendingExternalSubtitles.filter {
            !loadedExternalSubtitleURLs.contains($0.url)
        }
        pendingExternalSubtitles.removeAll(keepingCapacity: true)
        guard !subtitles.isEmpty else { return }
        loadedExternalSubtitleURLs.formUnion(subtitles.map(\.url))

        subtitleLock.lock()
        let generation = subtitleLoadGeneration
        subtitleLock.unlock()
        subtitleQueue.async { [weak self] in
            guard let self else { return }
            for subtitle in subtitles {
                self.subtitleLock.lock()
                let isCurrentLoad = self.subtitleLoadGeneration == generation
                self.subtitleLock.unlock()
                guard isCurrentLoad else { return }
                self.addSubtitle(subtitle)
            }
        }
    }

    private func invalidateExternalSubtitleLoads(clearPending: Bool = true) {
        subtitleLock.lock()
        subtitleLoadGeneration += 1
        subtitleLock.unlock()
        if clearPending { pendingExternalSubtitles.removeAll(keepingCapacity: true) }
    }

    private func updateSubtitlePosition() {
        guard mpv != nil else { return }
        let position: CGFloat
        guard
            (resizeMode == 1 || resizeMode == 2),
            videoWidth > 0,
            videoHeight > 0,
            videoSurfaceSize.width > 1,
            videoSurfaceSize.height > 1
        else {
            position = 100
            setStringProperty("sub-pos", "100")
            return
        }

        let baseScale = max(
            videoSurfaceSize.width / CGFloat(videoWidth),
            videoSurfaceSize.height / CGFloat(videoHeight),
        )
        let zoomScale = resizeMode == 2 ? CGFloat(pow(2.0, 0.15)) : 1
        let displayedHeight = CGFloat(videoHeight) * baseScale * zoomScale
        let croppedTop = max(0, (displayedHeight - videoSurfaceSize.height) / 2)
        position = min(
            100,
            max(0, (videoSurfaceSize.height + croppedTop) / displayedHeight * 100),
        )
        setStringProperty("sub-pos", String(format: "%.3f", Double(position)))
    }

    private func readEvents() {
        eventQueue.async { [weak self] in
            guard let self, let mpv = self.mpv else { return }
            while true {
                guard let event = mpv_wait_event(mpv, 0) else { return }
                let eventId = event.pointee.event_id
                if eventId == MPV_EVENT_NONE { return }

                switch eventId {
                case MPV_EVENT_PROPERTY_CHANGE:
                    let tracksChanged = event.pointee.reply_userdata == 6 ||
                        event.pointee.reply_userdata == 7
                    DispatchQueue.main.async { [weak self] in
                        self?.refreshPlaybackState()
                        if tracksChanged { self?.refreshTracks() }
                    }
                case MPV_EVENT_FILE_LOADED:
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        self.hasLoadedFile = true
                        self.clearError()
#if DEBUG
                        let elapsed = ProcessInfo.processInfo.systemUptime - self.loadStartedAtUptime
                        print(String(format: "[Conduit MPV][startup] file loaded in %.2fs", elapsed))
#endif
                        self.refreshPlaybackState()
                        self.refreshTracks()
                        let videoCodec = self.getString("video-codec")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        self.hasVideoStream = !videoCodec.isEmpty
                        if videoCodec.isEmpty {
                            self.waitingForInitialVideoFrame = false
                            if self.shouldPlay { self.setFlag("pause", false) }
                        }
                    }
                case MPV_EVENT_PLAYBACK_RESTART:
                    DispatchQueue.main.async { [weak self] in
                        self?.refreshPlaybackState()
                    }
                case MPV_EVENT_END_FILE:
                    guard let data = event.pointee.data else { continue }
                    let endFile = UnsafePointer<mpv_event_end_file>(OpaquePointer(data)).pointee
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        self.isPlayerEnded = endFile.reason != MPV_END_FILE_REASON_ERROR
                        if endFile.reason == MPV_END_FILE_REASON_ERROR {
                            self.recordError("[mpv] \(String(cString: mpv_error_string(endFile.error)))")
                        }
                    }
                case MPV_EVENT_LOG_MESSAGE:
                    guard let data = event.pointee.data,
                          let message = UnsafeMutablePointer<mpv_event_log_message>(OpaquePointer(data)).pointee.text,
                          let level = UnsafeMutablePointer<mpv_event_log_message>(OpaquePointer(data)).pointee.level
                    else { continue }
                    let text = String(cString: message).trimmingCharacters(in: .whitespacesAndNewlines)
                    let levelString = String(cString: level)
#if DEBUG
                    let rawLog = UnsafeMutablePointer<mpv_event_log_message>(OpaquePointer(data)).pointee
                    let prefix = rawLog.prefix.map(String.init(cString:)) ?? "mpv"
                    print("[Conduit MPV][\(prefix)][\(levelString)] \(text)")
#endif
                    if levelString == "error" || levelString == "fatal" {
                        self.recordDiagnostic(text)
                    }
                case MPV_EVENT_SHUTDOWN:
                    return
                default:
                    continue
                }
            }
        }
    }

    private func refreshTracks() {
        guard mpv != nil else { return }
        var audio: [ConduitTrack] = []
        var subtitles: [ConduitTrack] = []
        let count = getInt("track-list/count")
        let selectedSubtitleId = getInt("sid")
        var audioIndex = 0
        var subtitleIndex = 0

        for index in 0..<count {
            let type = getString("track-list/\(index)/type") ?? ""
            let id = getInt("track-list/\(index)/id")
            let title = getString("track-list/\(index)/title")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let language = getString("track-list/\(index)/lang")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let fallback = language.isEmpty ? "Track \(type == "sub" ? subtitleIndex + 1 : audioIndex + 1)" : language
            let track = ConduitTrack(
                id: id,
                title: title.isEmpty ? fallback : title,
                language: language,
                codec: getString("track-list/\(index)/codec")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
                channels: getString("track-list/\(index)/demux-channels")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
                channelCount: getInt("track-list/\(index)/demux-channel-count"),
                sampleRate: getInt("track-list/\(index)/demux-samplerate"),
                bitrate: Int64(getInt("track-list/\(index)/demux-bitrate")),
                external: getFlag("track-list/\(index)/external"),
                selected: type == "sub"
                    ? id == selectedSubtitleId
                    : getFlag("track-list/\(index)/selected")
            )
            if type == "audio" {
                audio.append(track)
                audioIndex += 1
            } else if type == "sub" {
                subtitles.append(track)
                subtitleIndex += 1
            }
        }

        audioTracks = audio
        subtitleTracks = subtitles
        applyPreferredSubtitleSelection()
    }

    /// Match the desktop player's precedence: wait for embedded metadata,
    /// prefer an embedded track in the configured language, and use an
    /// external/add-on track only when the file has no matching embedded one.
    private func applyPreferredSubtitleSelection() {
        guard mpv != nil, hasLoadedFile, !preferredSubtitleApplied else { return }
        let preferred = Self.languageCode(for: preferredSubtitleLanguage)
        guard !preferred.isEmpty else { return }

        let matching = subtitleTracks.filter {
            Self.languageCode(for: $0.language) == preferred
                || Self.languageCode(for: $0.title) == preferred
        }
        guard let track = matching.first(where: { !$0.external })
            ?? matching.first(where: { $0.external })
        else { return }

        preferredSubtitleApplied = true
        if !track.selected {
            var id = Int64(track.id)
            checkError(mpv_set_property(mpv, "sid", MPV_FORMAT_INT64, &id))
        }
    }

    private static func languageCode(for value: String) -> String {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        let base = normalized.split(separator: "-").first.map(String.init) ?? normalized
        return [
            "english": "en", "eng": "en", "spanish": "es", "español": "es", "spa": "es",
            "french": "fr", "fra": "fr", "fre": "fr", "german": "de", "deu": "de", "ger": "de",
            "italian": "it", "ita": "it", "portuguese": "pt", "por": "pt", "japanese": "ja", "jpn": "ja",
            "korean": "ko", "kor": "ko", "chinese": "zh", "zho": "zh", "chi": "zh", "arabic": "ar", "ara": "ar",
            "indonesian": "id", "ind": "id", "russian": "ru", "rus": "ru", "hindi": "hi", "hin": "hi",
        ][base] ?? (base.count == 2 ? base : "")
    }

    private func command(_ name: String, args: [String?] = [], checkForErrors: Bool = true) {
        guard let mpv else { return }
        var values = args
        values.insert(name, at: 0)
        values.append(nil)
        var cargs = values.map { value in
            value.flatMap { UnsafePointer<CChar>(strdup($0)) }
        }
        defer {
            for pointer in cargs where pointer != nil {
                free(UnsafeMutablePointer(mutating: pointer!))
            }
        }
        let status = mpv_command(mpv, &cargs)
        if checkForErrors { checkError(status) }
    }

    private func getDouble(_ name: String) -> Double {
        guard let mpv else { return 0 }
        var value = Double()
        _ = mpv_get_property(mpv, name, MPV_FORMAT_DOUBLE, &value)
        return value
    }

    private func getInt(_ name: String) -> Int {
        guard let mpv else { return 0 }
        var value = Int64()
        _ = mpv_get_property(mpv, name, MPV_FORMAT_INT64, &value)
        return Int(value)
    }

    private func getFlag(_ name: String) -> Bool {
        guard let mpv else { return false }
        var value = Int64()
        _ = mpv_get_property(mpv, name, MPV_FORMAT_FLAG, &value)
        return value != 0
    }

    private func getString(_ name: String) -> String? {
        guard let mpv, let pointer = mpv_get_property_string(mpv, name) else { return nil }
        defer { mpv_free(pointer) }
        return String(cString: pointer)
    }

    private func setFlag(_ name: String, _ value: Bool) {
        guard let mpv else { return }
        var flag = Int64(value ? 1 : 0)
        checkError(mpv_set_property(mpv, name, MPV_FORMAT_FLAG, &flag))
    }

    private func setStringProperty(_ name: String, _ value: String) {
        guard let mpv else { return }
        checkError(mpv_set_property_string(mpv, name, value))
    }

    private func applyPreferredAudioLanguage() {
        guard mpv != nil else { return }
        let normalized = preferredAudioLanguage.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let alang: String
        switch normalized {
        case "english": alang = "en"
        case "spanish": alang = "es"
        case "french": alang = "fr"
        case "german": alang = "de"
        case "japanese": alang = "ja"
        case "korean": alang = "ko"
        case "system default", "": alang = Locale.current.languageCode ?? "auto"
        default: alang = normalized
        }
        setStringProperty("alang", alang)
    }

    private func applyRequestHeaders(_ headers: [String: String]) {
        guard mpv != nil else { return }
        let serialized = headers
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .map { key, value in
                let escaped = value
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: ",", with: "\\,")
                return "\(key): \(escaped)"
            }
            .joined(separator: ",")
        setStringProperty("http-header-fields", serialized)
    }

    private func sanitizeHeaders(_ headers: [String: String]) -> [String: String] {
        headers.reduce(into: [:]) { result, entry in
            let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = entry.value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty, !value.isEmpty else { return }
            guard key.caseInsensitiveCompare("Range") != .orderedSame else { return }
            result[key] = value
        }
    }

    private func debugPlaybackState(
        position: Double,
        paused: Bool,
        cachePaused: Bool,
        coreIdle: Bool,
        seeking: Bool
    ) {
        renderStateLock.lock()
        let frames = enqueuedFrameCount
        let target = "\(poolWidth)x\(poolHeight)"
        renderStateLock.unlock()
        let snapshot = [
            String(format: "position=%.3f", position),
            "paused=\(paused)",
            "cachePaused=\(cachePaused)",
            "coreIdle=\(coreIdle)",
            "seeking=\(seeking)",
            "playingIntent=\(shouldPlay)",
            "video=\(videoWidth)x\(videoHeight)",
            "errorPresent=\(!currentErrorMessage.isEmpty)",
            "renderTarget=\(target)",
            String(format: "frames=%llu", frames),
            "surface=\(Int(videoSurfaceSize.width))x\(Int(videoSurfaceSize.height))",
        ].joined(separator: " ")
        guard snapshot != lastDebugPlaybackSnapshot else { return }
        lastDebugPlaybackSnapshot = snapshot
        debugLog("playback \(snapshot)")
    }

    private func debugLog(_ message: String) {
#if DEBUG
        print("[Conduit MPV][diagnostic] \(message)")
#else
        _ = message
#endif
    }

    private func applyPreferredRefreshRate() {
        guard frameRateDisplayLink == nil, view.window != nil else { return }
        let maxFps = Float(view.window?.screen.maximumFramesPerSecond ?? 60)
        let link = CADisplayLink(target: self, selector: #selector(frameRatePump(_:)))
        if #available(iOS 15.0, *) {
            link.preferredFrameRateRange = CAFrameRateRange(
                minimum: 24,
                maximum: maxFps,
                preferred: maxFps
            )
        }
        link.add(to: .main, forMode: .common)
        frameRateDisplayLink = link
        debugLog("refresh rate request applied max=\(Int(maxFps))")
    }

    @objc private func frameRatePump(_ link: CADisplayLink) {}

    private func runOnMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        Self.audioSessionQueue.async {
            do {
                try ConduitAudioSession.configureForPlayback(session)
                #if DEBUG
                print("[Conduit Audio][diagnostic] configured \(Self.audioSessionDescription(session))")
                #endif
            } catch {
                print("[Conduit MPV] Failed to configure audio session: \(error)")
            }
        }
    }

    private func activateAudioSession() {
        guard !audioSessionActivationRequested else { return }
        audioSessionActivationRequested = true
        let session = AVAudioSession.sharedInstance()
        Self.audioSessionQueue.async { [weak self] in
            do {
                try ConduitAudioSession.activateForPlayback()
                #if DEBUG
                print("[Conduit Audio][diagnostic] activated \(Self.audioSessionDescription(session))")
                #endif
            } catch {
                print("[Conduit MPV] Failed to activate audio session: \(error)")
                DispatchQueue.main.async {
                    self?.audioSessionActivationRequested = false
                }
            }
        }
    }

    private func deactivateAudioSession() {
        audioSessionActivationRequested = false
        let session = AVAudioSession.sharedInstance()
        Self.audioSessionQueue.async {
            do {
                try ConduitAudioSession.deactivateAfterPlayback()
            } catch {
                print("[Conduit MPV] Failed to deactivate audio session: \(error)")
            }
        }
    }

    private static func audioSessionDescription(_ session: AVAudioSession) -> String {
        let inputs = session.currentRoute.inputs.map { "\($0.portType.rawValue):\($0.portName)" }
        let outputs = session.currentRoute.outputs.map { "\($0.portType.rawValue):\($0.portName)" }
        return String(
            format: "category=%@ mode=%@ rate=%.0f buffer=%.4fs inputs=%@ outputs=%@",
            session.category.rawValue,
            session.mode.rawValue,
            session.sampleRate,
            session.ioBufferDuration,
            inputs.joined(separator: ","),
            outputs.joined(separator: ",")
        )
    }

    private func clearError() {
        errorLock.lock()
        recentErrors.removeAll(keepingCapacity: true)
        playbackError = nil
        errorLock.unlock()
    }

    private func recordError(_ message: String) {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        errorLock.lock()
        recentErrors.append(text)
        if recentErrors.count > 3 { recentErrors.removeFirst(recentErrors.count - 3) }
        playbackError = recentErrors.joined(separator: "\n")
        errorLock.unlock()
    }

    /// Decoder errors can describe a dropped frame that MPV recovers from.
    /// Keep them for a real end-of-file failure without stopping playback early.
    private func recordDiagnostic(_ message: String) {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        errorLock.lock()
        recentErrors.append(text)
        if recentErrors.count > 3 { recentErrors.removeFirst(recentErrors.count - 3) }
        errorLock.unlock()
    }
}

extension ConduitMPVPlayerViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}

/// Owns the AVKit PiP session on top of the shared sample-buffer surface.
///
/// Because the software renderer continuously feeds `displayLayer`, the
/// layer always holds current frames - there is no capture priming, no
/// burst refreshing, and no second pipeline. Every path still waits for
/// AVKit to confirm the transition before flipping bookkeeping, and the
/// automatic Home-swipe entry keeps its explicit-start approach, which is
/// what avoids opening onto a black or frozen window.
final class ConduitPictureInPictureCoordinator: NSObject,
    AVPictureInPictureControllerDelegate,
    AVPictureInPictureSampleBufferPlaybackDelegate {
    private weak var owner: ConduitMPVPlayerViewController?
    private var controller: AVPictureInPictureController?

    private var starting = false
    private var currentStartSource: String?
    private var transitionBegan = false
    private var startRequested = false
    private var preservePlaybackDuringStart = false
    private var ignorePauseUntil: CFTimeInterval = 0
    private var resumeAfterRestore = false

    private var automaticArmed = false
    private var resumePlaybackAfterBackground = false

    private var startTimeoutWork: DispatchWorkItem?
    private var automaticTimeoutWork: DispatchWorkItem?
    private var startRetryWork: DispatchWorkItem?
    private var restoreResumeWork: DispatchWorkItem?
    private var abortCancelWork: DispatchWorkItem?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    init(owner: ConduitMPVPlayerViewController) {
        self.owner = owner
        super.init()

        let source = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: owner.displayLayer,
            playbackDelegate: self
        )
        let controller = AVPictureInPictureController(contentSource: source)
        controller.delegate = self
        controller.requiresLinearPlayback = false
        // Automatic entry is managed by this coordinator: an explicit start
        // during the Home gesture replaces AVKit's inline trigger.
        controller.canStartPictureInPictureAutomaticallyFromInline = false
        self.controller = controller
    }

    var isSupported: Bool {
        AVPictureInPictureController.isPictureInPictureSupported() && controller != nil
    }

    var isActive: Bool {
        controller?.isPictureInPictureActive == true || controller?.isPictureInPictureSuspended == true
    }

    var isStartingOrActive: Bool { starting || automaticArmed || isActive }

    // MARK: - Manual start (PiP button)

    func start() {
        guard isSupported, !isActive, !starting else { return }
        debugLog("manual start requested")
        cancelAutomaticEntry()
        starting = true
        currentStartSource = "manual-button"
        preservePlaybackDuringStart = owner?.isPlayerPlaying == true
        ignorePauseUntil = 0
        scheduleStartTimeout()
        requestControllerStart(source: currentStartSource ?? "manual", attempt: 0)
    }

    func stop() {
        debugLog("stop requested")
        cancelStartTimeout()
        cancelAutomaticEntry()
        starting = false
        currentStartSource = nil
        clearPlaybackPreservation()
        endBackgroundTask()
        controller?.stopPictureInPicture()
        if !isActive {
            owner?.setInlineVideoHiddenForPictureInPicture(false)
        }
    }

    func stopForNewLoad(completion: @escaping () -> Void) {
        cancelStartTimeout()
        cancelAutomaticEntry()
        starting = false
        currentStartSource = nil
        clearPlaybackPreservation()
        endBackgroundTask()
        controller?.stopPictureInPicture()
        owner?.setInlineVideoHiddenForPictureInPicture(false)
        completion()
    }

    func playbackStateChanged() {
        controller?.invalidatePlaybackState()
    }

    func timelineDidSeek() {
        controller?.invalidatePlaybackState()
    }

    // MARK: - Automatic entry (Home swipe)

    /// With the renderer continuously feeding the shared surface, arming the
    /// Home-swipe path only needs bookkeeping; the layer is fresh by
    /// construction whenever playback is running.
    func handleHomeSwipeDetected() {
        guard let owner, owner.hasLoadedFile, !isActive, !starting, !automaticArmed else { return }
        guard owner.isPlayerPlaying, !owner.isPlayerEnded else { return }
        guard let controller else { return }

        debugLog("home swipe detected")
        automaticArmed = true
        starting = true
        currentStartSource = "automatic-home"
        preservePlaybackDuringStart = owner.isPlayerPlaying
        ignorePauseUntil = 0
        beginBackgroundTask()
        scheduleAutomaticTimeout()
        controller.invalidatePlaybackState()
        requestControllerStart(source: "automatic-home", attempt: 0)
    }

    /// The swipe aborted before the app left the foreground; unwind the armed
    /// transition and put the inline surface back.
    func scheduleAutomaticCancelIfAborted() {
        guard automaticArmed else { return }
        abortCancelWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard UIApplication.shared.applicationState == .active, self.automaticArmed else { return }
            self.debugLog("cancelling automatic PiP because the Home gesture was aborted")
            self.controller?.stopPictureInPicture()
            let shouldResume = self.preservePlaybackDuringStart
            self.cancelAutomaticEntry()
            if shouldResume { self.owner?.playPlayback() }
        }
        abortCancelWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75, execute: work)
    }

    /// The app became active again without entering the background, so the
    /// system never accepted the automatic transition.
    func cancelAutomaticEntryIfForegrounded() {
        defer {
            if !isActive, !starting {
                clearPlaybackPreservation()
            }
        }
        guard automaticArmed, !isActive else { return }

        let shouldResume = preservePlaybackDuringStart
        debugLog("automatic PiP cancelled because the app returned to the foreground")
        controller?.stopPictureInPicture()
        cancelAutomaticEntry()
        owner?.restoreVideoTrackAfterBackgroundIfNeeded(reloadDecoder: false)
        if shouldResume { owner?.playPlayback() }
    }

    func handleEnterBackground() {
        // Any in-flight start signal keeps the pipeline alive. Lifecycle
        // delivery around a Home-swipe PiP transition is racy: the background
        // notification can land while AVKit is still working on a start whose
        // bookkeeping flags have partially unwound.
        let startInFlight = transitionBegan || startRequested || starting || automaticArmed
        debugLog(
            "enterBackground active=\(isActive) transitionBegan=\(transitionBegan) " +
                "startRequested=\(startRequested) starting=\(starting) automaticArmed=\(automaticArmed)"
        )
        if isActive || startInFlight {
            debugLog("background with PiP pending/active; keeping primary pipeline alive")
            return
        }
        resumePlaybackAfterBackground = owner?.isPlayerPlaying == true
        owner?.suspendVideoTrackForBackground(reason: "background-without-pip")
    }

    func handleEnterForeground() {
        if isActive || starting { return }
        owner?.restoreVideoTrackAfterBackgroundIfNeeded()
        if resumePlaybackAfterBackground {
            resumePlaybackAfterBackground = false
            owner?.playPlayback()
        }
    }

    func invalidate(completion: (() -> Void)? = nil) {
        cancelStartTimeout()
        cancelAutomaticTimeout()
        startRetryWork?.cancel()
        startRetryWork = nil
        restoreResumeWork?.cancel()
        restoreResumeWork = nil
        abortCancelWork?.cancel()
        abortCancelWork = nil
        endBackgroundTask()

        controller?.stopPictureInPicture()
        controller?.delegate = nil
        controller = nil

        let displayLayer = owner?.displayLayer
        let cleanup = { () -> Void in
            if #available(iOS 18.0, *) {
                displayLayer?.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil)
            } else {
                displayLayer?.flushAndRemoveImage()
            }
        }
        if Thread.isMainThread {
            cleanup()
        } else {
            DispatchQueue.main.async(execute: cleanup)
        }
        completion?()
    }

    // MARK: - Start machinery

    private func requestControllerStart(source: String, attempt: Int) {
        guard let controller, !controller.isPictureInPictureActive else { return }
        if controller.isPictureInPicturePossible {
            debugLog("requesting PiP start source=\(source)")
            startRequested = true
            controller.invalidatePlaybackState()
            controller.startPictureInPicture()
            return
        }
        guard attempt < 40 else {
            debugLog("PiP never became possible source=\(source)")
            handleStartFailure(source: source)
            return
        }
        startRetryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.starting || self.automaticArmed else { return }
            self.requestControllerStart(source: source, attempt: attempt + 1)
        }
        startRetryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025, execute: work)
    }

    private func handleStartFailure(source: String) {
        debugLog("PiP start failed source=\(source)")
        // A transition that already began owns its own outcome through
        // didStop; tearing down underneath it would blank live content.
        guard !transitionBegan else { return }
        let wasPreserved = preservePlaybackDuringStart
        cancelStartTimeout()
        cancelAutomaticTimeout()
        startRetryWork?.cancel()
        startRetryWork = nil
        starting = false
        automaticArmed = false
        currentStartSource = nil
        transitionBegan = false
        startRequested = false
        endBackgroundTask()
        clearPlaybackPreservation()

        guard let owner else { return }
        if UIApplication.shared.applicationState == .background {
            owner.suspendVideoTrackForBackground(reason: "pip-start-failed")
            return
        }
        owner.setInlineVideoHiddenForPictureInPicture(false)
        if wasPreserved {
            ignorePauseUntil = CACurrentMediaTime() + 1.0
            owner.playPlayback()
        }
    }

    private func scheduleStartTimeout() {
        startTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.starting, !self.isActive else { return }
            self.debugLog("PiP start timed out before activation")
            self.handleStartFailure(source: "start-timeout")
        }
        startTimeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 10.0, execute: work)
    }

    private func cancelStartTimeout() {
        startTimeoutWork?.cancel()
        startTimeoutWork = nil
    }

    private func scheduleAutomaticTimeout() {
        automaticTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.automaticArmed || self.starting || self.startRequested else { return }
            guard !self.isActive else {
                self.cancelAutomaticEntry()
                return
            }
            self.debugLog("automatic PiP did not activate before timeout")
            self.controller?.stopPictureInPicture()
            self.handleStartFailure(source: "automatic-start-timeout")
        }
        automaticTimeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0, execute: work)
    }

    private func cancelAutomaticTimeout() {
        automaticTimeoutWork?.cancel()
        automaticTimeoutWork = nil
    }

    private func cancelAutomaticEntry() {
        automaticTimeoutWork?.cancel()
        automaticTimeoutWork = nil
        startRetryWork?.cancel()
        startRetryWork = nil
        automaticArmed = false
        startRequested = false
        endBackgroundTask()
        if !isActive {
            starting = false
            clearPlaybackPreservation()
        }
    }

    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(
            withName: "ConduitAutomaticPictureInPicture"
        ) { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                if !self.isActive {
                    self.controller?.stopPictureInPicture()
                    self.handleStartFailure(source: "background-task-expired")
                }
                self.endBackgroundTask()
            }
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func preservePlaybackAfterDidStart() {
        guard preservePlaybackDuringStart else { return }
        ignorePauseUntil = CACurrentMediaTime() + 0.45
        owner?.playPlayback()
        controller?.invalidatePlaybackState()
        debugLog("preserving playback through PiP start graceMs=450")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, CACurrentMediaTime() >= self.ignorePauseUntil else { return }
            self.preservePlaybackDuringStart = false
            self.ignorePauseUntil = 0
        }
    }

    private func clearPlaybackPreservation() {
        preservePlaybackDuringStart = false
        ignorePauseUntil = 0
    }

    // MARK: - AVPictureInPictureControllerDelegate

    func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        debugLog("will start")
        transitionBegan = true
        owner?.setInlineVideoHiddenForPictureInPicture(true)
    }

    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        debugLog("did start")
        cancelStartTimeout()
        cancelAutomaticTimeout()
        startRetryWork?.cancel()
        startRetryWork = nil
        automaticArmed = false
        endBackgroundTask()
        starting = false
        currentStartSource = nil
        startRequested = false
        preservePlaybackAfterDidStart()
        controller?.invalidatePlaybackState()
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        print("[Conduit PiP] Failed to start (\(currentStartSource ?? "unknown")): \(error)")
        debugLog("start failed")

        // AVKit provisionally reports failure for starts issued during the
        // Home gesture even when the transition then succeeds. The automatic
        // timeout owns real failure cleanup for this path; tearing down here
        // would pause MPV underneath a transition that is about to succeed.
        if currentStartSource == "automatic-home" {
            debugLog("ignoring provisional automatic start failure; timeout owns cleanup")
            return
        }
        handleStartFailure(source: currentStartSource ?? "unknown")
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        debugLog("did stop")
        cancelStartTimeout()
        cancelAutomaticTimeout()
        startRetryWork?.cancel()
        startRetryWork = nil
        automaticArmed = false
        starting = false
        currentStartSource = nil
        transitionBegan = false
        startRequested = false
        clearPlaybackPreservation()
        endBackgroundTask()
        owner?.setInlineVideoHiddenForPictureInPicture(false)

        if resumeAfterRestore {
            restoreResumeWork?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.restoreResumeWork = nil
                guard self.resumeAfterRestore else { return }
                self.resumeAfterRestore = false
                self.owner?.playPlayback()
                self.controller?.invalidatePlaybackState()
            }
            restoreResumeWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
        }
    }

    func pictureInPictureControllerWillStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        debugLog("will stop")
        transitionBegan = false
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        debugLog("restoring inline UI from PiP")
        resumeAfterRestore = true
        owner?.playPlayback()
        completionHandler(true)
    }

    // MARK: - AVPictureInPictureSampleBufferPlaybackDelegate

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        setPlaying playing: Bool
    ) {
        debugLog(
            "AVKit setPlaying=\(playing) starting=\(starting) active=\(isActive) " +
                "ownerPlaying=\(owner?.isPlayerPlaying == true)"
        )
        if !playing {
            if resumeAfterRestore {
                debugLog("ignored transient pause callback during PiP restore")
                return
            }
            let withinGrace = CACurrentMediaTime() < ignorePauseUntil
            if preservePlaybackDuringStart, starting || withinGrace {
                debugLog("ignored transient pause callback during PiP start")
                owner?.playPlayback()
                controller?.invalidatePlaybackState()
                return
            }
            clearPlaybackPreservation()
            owner?.pausePlayback()
        } else {
            // A previous failed transition may have suspended the video
            // track; restore it before resuming so PiP video keeps moving.
            owner?.restoreVideoTrackAfterBackgroundIfNeeded()
            owner?.playPlayback()
        }
        DispatchQueue.main.async { [weak self] in
            self?.controller?.invalidatePlaybackState()
        }
    }

    func pictureInPictureControllerTimeRangeForPlayback(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> CMTimeRange {
        let times = sanitizedPlaybackTimes()
        return CMTimeRange(start: .zero, duration: CMTime(seconds: times.duration, preferredTimescale: 1_000))
    }

    func pictureInPictureControllerIsPlaybackPaused(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> Bool {
        owner?.isPlayerPlaying != true
    }

    func pictureInPictureControllerShouldProhibitBackgroundAudioPlayback(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> Bool {
        false
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        didTransitionToRenderSize newRenderSize: CMVideoDimensions
    ) {}

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        skipByInterval skipInterval: CMTime,
        completion completionHandler: @escaping () -> Void
    ) {
        let seconds = CMTimeGetSeconds(skipInterval)
        guard seconds.isFinite else {
            completionHandler()
            return
        }
        owner?.seekByMs(Int64(seconds * 1_000))
        completionHandler()
    }

    /// AVKit renders nonsense scrubbers when the media clock has not settled;
    /// clamp both ends to something finite and plausible.
    private func sanitizedPlaybackTimes() -> (current: Double, duration: Double) {
        let rawCurrent = Double(owner?.positionMs ?? 0) / 1_000
        let rawDuration = Double(owner?.durationMs ?? 0) / 1_000
        let current = rawCurrent.isFinite ? max(0, rawCurrent) : 0
        let duration = rawDuration.isFinite && rawDuration > max(5, current + 1)
            ? rawDuration
            : max(600, current + 600)
        return (min(current, max(0, duration - 0.5)), duration)
    }

    private func debugLog(_ message: String) {
        #if DEBUG
        print("[Conduit PiP][diagnostic] \(message)")
        #endif
    }
}


enum ConduitVideoOutputRecoveryResult: String, Equatable {
    case none
    case retrying
    case scheduled
    case succeeded
    case failed
    case cancelled
}

struct ConduitVideoOutputRecoveryState: Equatable {
    private(set) var attempts = 0
    private(set) var startedAt: TimeInterval?
    private(set) var result: ConduitVideoOutputRecoveryResult = .none
    private(set) var failed = false
    private(set) var generation: UInt64 = 0

    var isActive: Bool {
        startedAt != nil || attempts > 0 || result == .retrying || result == .scheduled
    }

    mutating func beginRetry(at now: TimeInterval) {
        generation &+= 1
        attempts = 0
        startedAt = now
        result = .retrying
        failed = false
    }

    @discardableResult
    mutating func schedule(at now: TimeInterval) -> UInt64 {
        generation &+= 1
        if startedAt == nil { startedAt = now }
        result = .scheduled
        return generation
    }

    @discardableResult
    mutating func markAttempt(maxAttempts: Int) -> Bool {
        guard attempts < maxAttempts else { return false }
        attempts += 1
        result = .scheduled
        return true
    }

    mutating func deferAfterTransition() {
        generation &+= 1
        attempts = 0
        startedAt = nil
        result = .none
    }

    mutating func cancel(resetAttempts: Bool) {
        guard resetAttempts else { return }
        generation &+= 1
        if isActive { result = .cancelled }
        attempts = 0
        startedAt = nil
    }

    mutating func succeed() {
        guard isActive else { return }
        result = .succeeded
        attempts = 0
        startedAt = nil
    }

    mutating func fail() {
        failed = true
        result = .failed
    }

    func isCurrent(_ expectedGeneration: UInt64) -> Bool {
        generation == expectedGeneration
    }
}

enum ConduitVideoOutputWatchdogDecision: Equatable {
    case wait
    case healthy
    case recover
    case pause
}

enum ConduitVideoOutputWatchdogPolicy {
    static func shouldWatch(
        hasLoadedFile: Bool,
        hasVideoStream: Bool,
        shouldPlay: Bool,
        waitingForInitialVideoFrame: Bool,
        recoveryFailed: Bool,
        pictureInPictureActive: Bool,
        destroyStarted: Bool
    ) -> Bool {
        hasLoadedFile &&
            hasVideoStream &&
            shouldPlay &&
            !waitingForInitialVideoFrame &&
            !recoveryFailed &&
            !pictureInPictureActive &&
            !destroyStarted
    }

    static func decision(
        surfaceTransitionInProgress: Bool,
        mediaClockAdvancing: Bool,
        heartbeatFresh: Bool,
        heartbeatChanged: Bool,
        recoveryAttempts: Int,
        maxRecoveryAttempts: Int,
        recoveryStarted: Bool = false,
        recoveryElapsed: TimeInterval? = nil,
        recoveryTimeout: TimeInterval = 1.5
    ) -> ConduitVideoOutputWatchdogDecision {
        guard !surfaceTransitionInProgress else { return .wait }
        if !mediaClockAdvancing {
            if recoveryStarted,
               let recoveryElapsed,
               recoveryElapsed >= recoveryTimeout {
                return .pause
            }
            return .wait
        }
        if heartbeatFresh || heartbeatChanged { return .healthy }
        if recoveryAttempts >= maxRecoveryAttempts { return .pause }
        return .recover
    }
}

enum ConduitSurfaceTransitionPolicy {
    static func shouldScheduleDrawableResize(
        size: CGSize,
        pendingSize: CGSize?,
        hasPendingResize: Bool
    ) -> Bool {
        size != pendingSize || !hasPendingResize
    }

    static func canApplyDrawable(
        interactiveResizeActive: Bool,
        surfaceTransitionActive: Bool,
        coordinatorSurfaceTransitionActive: Bool
    ) -> Bool {
        !interactiveResizeActive &&
            !surfaceTransitionActive &&
            !coordinatorSurfaceTransitionActive
    }
}

/// Registers a known FreeType-readable CJK font before libmpv starts. iOS
/// system fonts are available to CoreText but are not reliably discoverable by
/// the FreeType/libass provider used by the bundled MPVKit build, which can
/// turn Han glyphs into boxes and make fallback work happen repeatedly.
final class ConduitSubtitleFontController {
    private static let family = "Noto Sans CJK SC"
    private var registered = false

    func applySetupOptions(_ setOption: (String, String) -> Void) {
        guard registerBundledFont() else { return }
        setOption("sub-font", Self.family)
        // Noto keeps CJK lookup deterministic, but mpv's 38px plain-text
        // default is noticeably smaller than the common embedded ASS styles.
        // Match Nuvio's 18sp iOS baseline, which maps to 54 scaled pixels.
        setOption("sub-font-size", "54")
    }

    private func registerBundledFont() -> Bool {
        if registered { return true }
        guard let url = Bundle.main.url(
            forResource: "NotoSansCJKsc-Regular",
            withExtension: "otf",
            subdirectory: "SubtitleFonts",
        ) ?? Bundle.main.url(
            forResource: "NotoSansCJKsc-Regular",
            withExtension: "otf",
        ) else {
            print("[Conduit MPV] CJK subtitle font resource is missing")
            return false
        }

        var error: Unmanaged<CFError>?
        let didRegister = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        if !didRegister {
            let message = error?.takeRetainedValue().localizedDescription ?? "unknown error"
            // A second player can legitimately see the process-wide font as
            // already registered. Verify the family before treating it as a
            // failure so the player still uses the known-good font.
            let font = CTFontCreateWithName(Self.family as CFString, 12, nil)
            if (CTFontCopyFamilyName(font) as String) != Self.family {
                print("[Conduit MPV] CJK subtitle font registration failed: \(message)")
                return false
            }
        }

        registered = true
        return true
    }
}

private func checkError(_ status: CInt) {
    if status < 0 {
        print("[Conduit MPV] API error: \(String(cString: mpv_error_string(status)))")
    }
}

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
