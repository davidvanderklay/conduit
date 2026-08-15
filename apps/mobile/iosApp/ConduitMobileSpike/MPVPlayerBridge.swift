import AVFoundation
import AVKit
import ComposeApp
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

/// The Swift half of the Kotlin/iOS player boundary.
///
/// This follows the same shape as Nuvio's iOS integration: Compose owns the
/// screen and controls, while UIKit owns libmpv, decoded frames, and the
/// CAMetalLayer used by MPVKit's MoltenVK video output.
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
    private static let surfaceSettleDelay: TimeInterval = 0.22
    private static let videoOutputWatchdogInterval: TimeInterval = 0.5
    private static let videoOutputRecoveryDelay: TimeInterval = 0.4
    private static let mediaClockStallTimeout: TimeInterval = 1.5
    private static let videoOutputRecoveryTimeout: TimeInterval = 1.5
    private static let maxVideoOutputRecoveryAttempts = 2
    // Audio route changes can block. Serialize them across player instances
    // without making the Compose/UIKit thread wait for the system audio route.
    private static let audioSessionQueue = DispatchQueue(label: "media.conduit.audio-session", qos: .userInitiated)

    private let eventQueue = DispatchQueue(label: "media.conduit.mpv-events", qos: .userInitiated)
    private let subtitleQueue = DispatchQueue(label: "media.conduit.mpv-subtitles", qos: .utility)
    private let subtitleLock = NSLock()
    private let errorLock = NSLock()
    fileprivate let pictureInPictureClock = ConduitPipPlaybackClock()
    private var metalLayer = ConduitMetalLayer()
    private let pictureInPicturePlaceholderLayer = CALayer()
    private var pictureInPicture: ConduitPictureInPictureCoordinator?
    private var mpv: OpaquePointer?
    private var pendingLoad: ConduitPendingLoad?
    private var pendingRetry: DispatchWorkItem?
    private var activeHeaders: [String: String] = [:]
    private var preferredAudioLanguage = "System default"
    private var preferredSubtitleLanguage = "English"
    private var preferredSubtitleApplied = false
    private var hasLoadedFile = false
    private var shouldPlay = false
    private var resumeAfterForeground = false
    private var resumeAfterAudioInterruption = false
    private var backgroundedWithPictureInPicture = false
    private var pendingForegroundRestore = false
    private var lastDrawableSize: CGSize = .zero
    private var videoSurfaceSize: CGSize = .zero
    private var settledMetalBounds: CGRect = .zero
    private var externallyManagedViewSize: CGSize?
    private var pendingSurfaceLayoutWorkItems: [DispatchWorkItem] = []
    private var pendingDrawableResize: DispatchWorkItem?
    private var pendingDrawableSize: CGSize?
    private var pendingDrawableBounds: CGRect?
    private var interactiveResizeActive = false
    private var surfaceTransitionActive = false
    private var coordinatorSurfaceTransitionActive = false
    private var pendingSurfaceTransitionEnd: DispatchWorkItem?
    private var pendingVideoOutputRecovery: DispatchWorkItem?
    private var pendingVideoOutputWatchdog: DispatchWorkItem?
    private var videoOutputRecoveryState = ConduitVideoOutputRecoveryState()
    private var lastObservedDrawableHeartbeat: UInt64 = 0
    private var lastWatchedMediaPositionMs: Int64?
    private var lastMediaClockProgressUptime: TimeInterval = 0
    private var hasVideoStream = false
    private var pendingBackgroundPause: DispatchWorkItem?
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var recentErrors: [String] = []
    private var playbackError: String?
    private var waitingForInitialVideoFrame = false
    private var pendingExternalSubtitles: [ConduitSubtitle] = []
    private var subtitleLoadGeneration = 0
    private var loadStartedAtUptime: TimeInterval = 0
    private var destroyStarted = false
    private var resizeMode = 0
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

        metalLayer.contentsGravity = .resize
        metalLayer.contentsScale = UIScreen.main.nativeScale
        metalLayer.pixelFormat = .rgba16Float
        metalLayer.framebufferOnly = false
        metalLayer.backgroundColor = UIColor.black.cgColor
        metalLayer.anchorPoint = CGPoint(x: 0, y: 0)
        metalLayer.position = .zero
        view.layer.addSublayer(metalLayer)
        pictureInPicture = ConduitPictureInPictureCoordinator(owner: self, metalLayer: metalLayer)
        pictureInPicturePlaceholderLayer.backgroundColor = UIColor.black.cgColor
        pictureInPicturePlaceholderLayer.opacity = 0
        view.layer.addSublayer(pictureInPicturePlaceholderLayer)

        setupMpv()
        activateAudioSession()
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pictureInPicture?.prepareForAutomaticEntry()
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
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutMetalLayer()
        pictureInPicture?.layout(in: view.bounds)
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

        setSurfaceTransitionActive(true)
        syncVideoSurfaceLayoutNow(scheduleDeferredPasses: false)
        coordinator.animate(alongsideTransition: { [weak self] _ in
            self?.syncVideoSurfaceLayoutNow(scheduleDeferredPasses: false)
        }, completion: { [weak self] _ in
            self?.setSurfaceTransitionActive(false)
            self?.syncVideoSurfaceLayout()
            self?.attemptStartPendingLoad()
        })
    }

    func syncVideoSurfaceLayout(_ size: CGSize) {
        runOnMain { [weak self] in
            self?.syncVideoSurfaceLayoutNow(size: size, scheduleDeferredPasses: true)
        }
    }

    func setInteractiveResize(_ active: Bool) {
        runOnMain { [weak self] in
            guard let self, !self.destroyStarted, self.interactiveResizeActive != active else { return }
            self.interactiveResizeActive = active
            self.pendingDrawableResize?.cancel()
            self.pendingDrawableResize = nil
            self.pendingSurfaceTransitionEnd?.cancel()
            self.pendingSurfaceTransitionEnd = nil
            if active {
                if !self.coordinatorSurfaceTransitionActive {
                    self.surfaceTransitionActive = true
                }
                self.cancelVideoOutputRecovery(resetAttempts: true)
            } else if !self.coordinatorSurfaceTransitionActive {
                self.surfaceTransitionActive = false
            }
            self.updateLiveResizeState()
            if !active {
                self.layoutMetalLayer()
                self.updateLiveResizeState()
                self.resetVideoOutputObservations()
                self.scheduleVideoOutputWatchdog()
            }
        }
    }

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

        if Thread.isMainThread {
            pictureInPicture?.stopForNewLoad()
            pendingLoad = request
            attemptStartPendingLoad()
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.pictureInPicture?.stopForNewLoad()
                self?.pendingLoad = request
                self?.attemptStartPendingLoad()
            }
        }
    }

    func playPlayback() {
        playPlayback(scheduleWatchdog: true)
    }

    private func playPlayback(scheduleWatchdog: Bool) {
        runOnMain { [weak self] in
            guard let self else { return }
            self.shouldPlay = true
            guard self.mpv != nil, !self.waitingForInitialVideoFrame else { return }
            if self.videoOutputRecoveryState.failed {
                self.retryVideoOutputOnMain()
                return
            }
            self.setFlag("pause", false)
            self.isPlayerPlaying = true
            self.refreshPlaybackState()
            if scheduleWatchdog {
                self.scheduleVideoOutputWatchdog()
            }
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func pausePlayback() {
        runOnMain { [weak self] in
            guard let self else { return }
            self.shouldPlay = false
            self.resetMediaClockObservation()
            self.cancelVideoOutputWatchdog()
            self.cancelVideoOutputRecovery(resetAttempts: true)
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
            self.resetMediaClockObservation()
            self.pictureInPictureClock.reset(positionMs: milliseconds)
            self.pictureInPicture?.timelineDidSeek()
            self.command("seek", args: [String(format: "%.3f", Double(milliseconds) / 1000.0), "absolute"])
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func seekByMs(_ milliseconds: Int64) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
            self.resetMediaClockObservation()
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
            if self.hasLoadedFile { self.noteSurfaceGeometryChange() }
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
            self.updateSubtitlePosition()
        }
    }

    func retryVideoOutput() {
        runOnMain { [weak self] in
            self?.retryVideoOutputOnMain()
        }
    }

    private func retryVideoOutputOnMain() {
        guard mpv != nil, hasLoadedFile else { return }
        videoOutputRecoveryState.beginRetry(at: ProcessInfo.processInfo.systemUptime)
        resetVideoOutputObservations()
        clearError()
        shouldPlay = true
        setStringProperty("vid", "no")
        setStringProperty("vid", "auto")
        setFlag("pause", false)
        refreshPlaybackState()
        scheduleVideoOutputWatchdog()
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
            self.preferredSubtitleApplied = true
            if trackId < 0 {
                self.setStringProperty("sid", "no")
            } else {
                var id = Int64(trackId)
                checkError(mpv_set_property(self.mpv, "sid", MPV_FORMAT_INT64, &id))
            }
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
            scheduleVideoOutputWatchdog()
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
        let outputWidth = getInt("video-out-params/w")
        let outputHeight = getInt("video-out-params/h")
        let activeFrameRate = getDouble("video-params/fps")
        let containerFrameRate = getDouble("container-fps")
        let decodedWidth = outputWidth > 0 ? outputWidth : getInt("video-params/w")
        let decodedHeight = outputHeight > 0 ? outputHeight : getInt("video-params/h")
        let nextVideoWidth = max(decodedWidth, 0)
        let nextVideoHeight = max(decodedHeight, 0)
        let videoSizeChanged = videoWidth != nextVideoWidth || videoHeight != nextVideoHeight
        if !videoCodec.isEmpty { hasVideoStream = true }

        _ = mpv
        // A surface transition can make MPV briefly idle while the Metal
        // drawable is being replaced. That is not media buffering and should
        // not cover the last good frame with the buffering overlay.
        let mediaBuffering = buffering || seeking
        isPlayerBuffering = hasLoadedFile
            && !waitingForInitialVideoFrame
            && shouldPlay
            && !paused
            && !eofReached
            && !isSurfaceTransitionInProgress
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
        if videoSizeChanged { updateSubtitlePosition() }
#if DEBUG
        debugPlaybackState(
            position: position,
            paused: paused,
            cachePaused: buffering,
            coreIdle: idle,
            seeking: seeking,
            drawable: metalLayer.drawableHeartbeatSnapshot()
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

    fileprivate func suspendVideoOutputWatchdogForPictureInPicture() {
        cancelVideoOutputWatchdog()
        cancelVideoOutputRecovery(resetAttempts: true)
        debugLog("video output watchdog suspended for PiP")
    }

    fileprivate func resumeVideoOutputWatchdogAfterPictureInPicture() {
        guard !destroyStarted else { return }
        resetVideoOutputObservations()
        debugLog("video output watchdog resumed after PiP")
        scheduleVideoOutputWatchdog()
    }

    func destroyPlayer() {
        if !Thread.isMainThread {
            DispatchQueue.main.sync { [weak self] in self?.destroyPlayer() }
            return
        }

        guard !destroyStarted else { return }
        destroyStarted = true

        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        lifecycleObservers.removeAll()
        pendingRetry?.cancel()
        pendingRetry = nil
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll()
        pendingSurfaceTransitionEnd?.cancel()
        pendingSurfaceTransitionEnd = nil
        pendingDrawableResize?.cancel()
        pendingDrawableResize = nil
        pendingDrawableSize = nil
        pendingDrawableBounds = nil
        cancelVideoOutputWatchdog()
        cancelVideoOutputRecovery(resetAttempts: true)
        pendingBackgroundPause?.cancel()
        pendingBackgroundPause = nil
        // UIKit can deliver one or more layout passes after this controller is
        // removed. Do not let teardown shrink the drawable while MPV's render
        // thread is still draining its previous swapchain.
        metalLayer.isNuvioLiveResize = true
        metalLayer.isHidden = true
        pendingLoad = nil
        shouldPlay = false
        pictureInPicture?.invalidate()
        pictureInPicture = nil
        deactivateAudioSession()

        guard let context = mpv else { return }
        mpv = nil
        invalidateExternalSubtitleLoads()

        // All wakeup callbacks enqueue work on these queues. Drain them before
        // terminating libmpv, but keep both the wait and MoltenVK teardown off
        // the main thread so leaving the player can update the UI immediately.
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            subtitleQueue.sync {}
            eventQueue.sync {}
            mpv_terminate_destroy(context)
        }
    }

    deinit {
        destroyPlayer()
    }

    private func enterBackground() {
        guard mpv != nil else { return }
        if pictureInPicture?.isStartingOrActive == true {
            backgroundedWithPictureInPicture = true
            resumeAfterForeground = false
            pendingBackgroundPause?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self,
                      !self.destroyStarted,
                      self.pictureInPicture?.isActive != true,
                      UIApplication.shared.applicationState != .active
                else { return }
                self.pendingBackgroundPause = nil
                self.backgroundedWithPictureInPicture = false
                self.resumeAfterForeground = self.isPlayerPlaying || self.shouldPlay
                self.pausePlayback()
                self.setStringProperty("vid", "no")
            }
            pendingBackgroundPause = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: work)
            return
        }
        pendingBackgroundPause?.cancel()
        pendingBackgroundPause = nil
        backgroundedWithPictureInPicture = false
        resumeAfterForeground = isPlayerPlaying || shouldPlay
        pendingRetry?.cancel()
        pendingRetry = nil
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll()
        pendingSurfaceTransitionEnd?.cancel()
        pendingSurfaceTransitionEnd = nil
        pendingDrawableResize?.cancel()
        pendingDrawableResize = nil
        pendingDrawableSize = nil
        cancelVideoOutputWatchdog()
        cancelVideoOutputRecovery(resetAttempts: true)
        pausePlayback()
        setStringProperty("vid", "no")
    }

    private func enterForeground() {
        guard mpv != nil else { return }
        pendingBackgroundPause?.cancel()
        pendingBackgroundPause = nil
        if backgroundedWithPictureInPicture && pictureInPicture?.isActive == true {
            // AVKit owns the stop transition. Do not rebind MPV's video
            // output until the PiP delegate has stopped capture and restored
            // the watchdog.
            pendingForegroundRestore = true
            pictureInPicture?.stop()
            return
        }
        backgroundedWithPictureInPicture = false
        syncVideoSurfaceLayout()
        attemptStartPendingLoad()
        setStringProperty("vid", "auto")
        if resumeAfterForeground {
            playPlayback()
        }
        resumeAfterForeground = false
    }

    fileprivate func restoreVideoAfterPictureInPictureStopIfNeeded() {
        guard pendingForegroundRestore, !destroyStarted else { return }
        pendingForegroundRestore = false
        backgroundedWithPictureInPicture = false
        syncVideoSurfaceLayout()
        attemptStartPendingLoad()
        setStringProperty("vid", "auto")
        if resumeAfterForeground {
            playPlayback(scheduleWatchdog: false)
        }
        resumeAfterForeground = false
    }

    private func handleAudioInterruption(_ notification: Notification) {
        guard
            let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType)
        else { return }

        switch type {
        case .began:
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

    private func setSurfaceTransitionActive(_ active: Bool) {
        guard !destroyStarted else { return }
        pendingSurfaceTransitionEnd?.cancel()
        pendingSurfaceTransitionEnd = nil
        coordinatorSurfaceTransitionActive = active
        surfaceTransitionActive = active
        if active {
            pendingDrawableResize?.cancel()
            pendingDrawableResize = nil
            pendingDrawableSize = nil
            pendingDrawableBounds = nil
            cancelVideoOutputRecovery(resetAttempts: true)
        }
        updateLiveResizeState()
        if !active {
            if !applyPendingDrawableResizeIfSettled() {
                layoutMetalLayer()
            }
            resetVideoOutputObservations()
            scheduleVideoOutputWatchdog()
        }
    }

    private var isSurfaceTransitionInProgress: Bool {
        interactiveResizeActive || surfaceTransitionActive || pendingDrawableResize != nil
    }

    /// UIKit does not always call viewWillTransition for Split View and Stage
    /// Manager divider movement. Treat a changing drawable target as a short
    /// surface transition so renderer churn never becomes media buffering.
    private func noteSurfaceGeometryChange() {
        guard !destroyStarted, !interactiveResizeActive, !coordinatorSurfaceTransitionActive else { return }
        if !surfaceTransitionActive {
            surfaceTransitionActive = true
            cancelVideoOutputRecovery(resetAttempts: true)
            updateLiveResizeState()
        }
        pendingSurfaceTransitionEnd?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.destroyStarted else { return }
            self.pendingSurfaceTransitionEnd = nil
            self.surfaceTransitionActive = false
            self.updateLiveResizeState()
            if !self.applyPendingDrawableResizeIfSettled() {
                self.layoutMetalLayer()
            }
            self.resetVideoOutputObservations()
            self.scheduleVideoOutputWatchdog()
            self.debugLog("surface transition settled")
        }
        pendingSurfaceTransitionEnd = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.surfaceSettleDelay, execute: work)
        debugLog("surface transition began")
    }

    private func updateLiveResizeState() {
        let active = isSurfaceTransitionInProgress
        metalLayer.isNuvioLiveResize = active
    }

    /// Applies the coalesced drawable only after every transition owner has
    /// released the surface. The delayed work item may fire while a UIKit
    /// transition is still active, so the transition end path must own the
    /// final application as well.
    @discardableResult
    private func applyPendingDrawableResizeIfSettled() -> Bool {
        guard !destroyStarted,
              ConduitSurfaceTransitionPolicy.canApplyDrawable(
                  interactiveResizeActive: interactiveResizeActive,
                  surfaceTransitionActive: surfaceTransitionActive,
                  coordinatorSurfaceTransitionActive: coordinatorSurfaceTransitionActive
              ),
              let size = pendingDrawableSize,
              let bounds = pendingDrawableBounds
        else { return false }

        pendingDrawableResize?.cancel()
        pendingDrawableResize = nil
        pendingDrawableSize = nil
        pendingDrawableBounds = nil
        applyDrawableSize(size, bounds: bounds)
        updateLiveResizeState()
        return true
    }

    private func scheduleVideoOutputWatchdog() {
        guard shouldWatchVideoOutput else { return }
        pendingVideoOutputWatchdog?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.checkVideoOutputHeartbeat()
        }
        pendingVideoOutputWatchdog = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.videoOutputWatchdogInterval,
            execute: work
        )
    }

    private func cancelVideoOutputWatchdog() {
        pendingVideoOutputWatchdog?.cancel()
        pendingVideoOutputWatchdog = nil
    }

    private var shouldWatchVideoOutput: Bool {
        ConduitVideoOutputWatchdogPolicy.shouldWatch(
            hasLoadedFile: hasLoadedFile,
            hasVideoStream: hasVideoStream,
            shouldPlay: shouldPlay,
            waitingForInitialVideoFrame: waitingForInitialVideoFrame,
            recoveryFailed: videoOutputRecoveryState.failed,
            pictureInPictureActive: pictureInPicture?.isStartingOrActive == true,
            destroyStarted: destroyStarted,
        )
    }

    private func checkVideoOutputHeartbeat() {
        pendingVideoOutputWatchdog = nil
        guard shouldWatchVideoOutput else { return }

        refreshPlaybackState()
        guard shouldWatchVideoOutput else { return }

        // A genuine cache wait or seek is owned by MPV. Rebinding the video
        // output while the demuxer is waiting would only add more churn.
        guard !getFlag("paused-for-cache"),
              !getFlag("core-idle"),
              !getFlag("seeking"),
              !getFlag("pause"),
              !getFlag("eof-reached")
        else {
            scheduleVideoOutputWatchdog()
            return
        }

        let heartbeat = metalLayer.drawableHeartbeatSnapshot()
        let now = ProcessInfo.processInfo.systemUptime
        let heartbeatIsFresh = heartbeat.uptime > 0 &&
            now - heartbeat.uptime < Self.videoOutputWatchdogInterval * 1.5
        let recoveryWasActive = videoOutputRecoveryState.isActive ||
            pendingVideoOutputRecovery != nil ||
            videoOutputRecoveryState.result == .retrying
        switch ConduitVideoOutputWatchdogPolicy.decision(
            surfaceTransitionInProgress: isSurfaceTransitionInProgress,
            mediaClockAdvancing: mediaClockIsAdvancing(),
            heartbeatFresh: heartbeatIsFresh,
            heartbeatChanged: heartbeat.count != lastObservedDrawableHeartbeat,
            recoveryAttempts: videoOutputRecoveryState.attempts,
            maxRecoveryAttempts: Self.maxVideoOutputRecoveryAttempts,
            recoveryStarted: recoveryWasActive,
            recoveryElapsed: videoOutputRecoveryState.startedAt.map { now - $0 },
            recoveryTimeout: Self.videoOutputRecoveryTimeout,
        ) {
        case .wait:
            scheduleVideoOutputWatchdog()
        case .healthy:
            lastObservedDrawableHeartbeat = heartbeat.count
            if recoveryWasActive, let started = videoOutputRecoveryState.startedAt {
                debugLog(
                    "video output rebind succeeded after " +
                        String(format: "%.2f", now - started) +
                        "s"
                )
            }
            if recoveryWasActive { videoOutputRecoveryState.succeed() }
            cancelVideoOutputRecovery(resetAttempts: true)
            scheduleVideoOutputWatchdog()
        case .recover:
            debugLog("video output heartbeat stale count=\(heartbeat.count) age=\(String(format: "%.2f", ProcessInfo.processInfo.systemUptime - heartbeat.uptime))s")
            scheduleVideoOutputRecovery()
            scheduleVideoOutputWatchdog()
        case .pause:
            pauseForVideoOutputFailure()
        }
    }

    private func cancelVideoOutputRecovery(resetAttempts: Bool) {
        pendingVideoOutputRecovery?.cancel()
        pendingVideoOutputRecovery = nil
        videoOutputRecoveryState.cancel(resetAttempts: resetAttempts)
    }

    private func resetMediaClockObservation() {
        lastWatchedMediaPositionMs = nil
        lastMediaClockProgressUptime = 0
    }

    private func resetVideoOutputObservations() {
        lastObservedDrawableHeartbeat = metalLayer.drawableHeartbeatSnapshot().count
        resetMediaClockObservation()
    }

    private func mediaClockIsAdvancing() -> Bool {
        let now = ProcessInfo.processInfo.systemUptime
        let position = positionMs
        if let lastPosition = lastWatchedMediaPositionMs,
           position > lastPosition + 50 {
            lastMediaClockProgressUptime = now
        }
        lastWatchedMediaPositionMs = position
        return lastMediaClockProgressUptime > 0 &&
            now - lastMediaClockProgressUptime < Self.mediaClockStallTimeout
    }

    private func scheduleVideoOutputRecovery() {
        guard shouldWatchVideoOutput,
              !isSurfaceTransitionInProgress,
              pendingVideoOutputRecovery == nil
        else { return }

        guard videoOutputRecoveryState.attempts < Self.maxVideoOutputRecoveryAttempts else {
            pauseForVideoOutputFailure()
            return
        }

        let recoveryGeneration = videoOutputRecoveryState.schedule(
            at: ProcessInfo.processInfo.systemUptime
        )
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.videoOutputRecoveryState.isCurrent(recoveryGeneration),
                  !self.destroyStarted,
                  self.hasLoadedFile,
                  self.shouldPlay,
                  self.pictureInPicture?.isStartingOrActive != true
            else { return }
            self.pendingVideoOutputRecovery = nil
            guard !self.isSurfaceTransitionInProgress else {
                self.videoOutputRecoveryState.deferAfterTransition()
                self.scheduleVideoOutputWatchdog()
                return
            }
            guard self.videoOutputRecoveryState.markAttempt(maxAttempts: Self.maxVideoOutputRecoveryAttempts) else {
                self.pauseForVideoOutputFailure()
                return
            }
            self.debugLog("video output recovery attempt \(self.videoOutputRecoveryState.attempts)")
            self.setStringProperty("vid", "no")
            self.setStringProperty("vid", "auto")
            self.debugLog("video output rebind requested")
            self.refreshPlaybackState()
            self.scheduleVideoOutputWatchdog()
        }
        pendingVideoOutputRecovery = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.videoOutputRecoveryDelay, execute: work)
    }

    private func pauseForVideoOutputFailure() {
        guard !videoOutputRecoveryState.failed, !destroyStarted else { return }
        videoOutputRecoveryState.fail()
        shouldPlay = false
        resetMediaClockObservation()
        let elapsed = videoOutputRecoveryState.startedAt.map {
            ProcessInfo.processInfo.systemUptime - $0
        }
        cancelVideoOutputWatchdog()
        cancelVideoOutputRecovery(resetAttempts: false)
        setFlag("pause", true)
        isPlayerPlaying = false
        recordError("Video output stopped responding. Retry playback to reconnect the picture.")
        refreshPlaybackState()
        if let elapsed {
            debugLog("video output recovery failed after \(String(format: "%.2f", elapsed))s; paused audio and video")
        } else {
            debugLog("video output recovery failed; paused audio and video")
        }
    }

    fileprivate func setInlineVideoHiddenForPictureInPicture(_ hidden: Bool) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        pictureInPicturePlaceholderLayer.opacity = hidden ? 1 : 0
        CATransaction.commit()
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
        var layerPointer = Int64(Int(bitPattern: Unmanaged.passUnretained(metalLayer).toOpaque()))
        checkError(mpv_set_option(mpv, "wid", MPV_FORMAT_INT64, &layerPointer))
        checkError(mpv_set_option_string(mpv, "vo", "gpu-next"))
        checkError(mpv_set_option_string(mpv, "gpu-api", "vulkan"))
        checkError(mpv_set_option_string(mpv, "gpu-context", "moltenvk"))
#if targetEnvironment(simulator)
        // VideoToolbox in the simulator can report success without producing
        // displayable frames. Software decoding still exercises the real
        // MPV/MoltenVK presentation path used by the app.
        checkError(mpv_set_option_string(mpv, "hwdec", "no"))
#else
        checkError(mpv_set_option_string(mpv, "hwdec", "videotoolbox"))
        checkError(mpv_set_option_string(mpv, "hwdec-software-fallback", "yes"))
#endif
        checkError(mpv_set_option_string(mpv, "ao", Self.audioOutput))
        checkError(mpv_set_option_string(mpv, "audio-channels", "auto"))
        checkError(mpv_set_option_string(mpv, "audio-fallback-to-null", "yes"))
        checkError(mpv_set_option_string(mpv, "vulkan-swap-mode", "fifo"))
        checkError(mpv_set_option_string(mpv, "vulkan-queue-count", "1"))
        checkError(mpv_set_option_string(mpv, "vulkan-async-compute", "no"))
        checkError(mpv_set_option_string(mpv, "vulkan-async-transfer", "no"))
        checkError(mpv_set_option_string(mpv, "vulkan-disable-interop", "yes"))
        checkError(mpv_set_option_string(mpv, "video-rotate", "no"))
        checkError(mpv_set_option_string(mpv, "input-default-bindings", "no"))
        checkError(mpv_set_option_string(mpv, "input-vo-keyboard", "no"))
        checkError(mpv_set_option_string(mpv, "osc", "no"))
        checkError(mpv_set_option_string(mpv, "keep-open", "yes"))
        checkError(mpv_set_option_string(mpv, "subs-match-os-language", "yes"))
        checkError(mpv_set_option_string(mpv, "subs-fallback", "yes"))
        checkError(mpv_set_option_string(mpv, "target-colorspace-hint", "yes"))
        checkError(mpv_set_option_string(mpv, "tone-mapping", "auto"))
        checkError(mpv_set_option_string(mpv, "hdr-compute-peak", "yes"))

        let initializeStatus = mpv_initialize(mpv)
        checkError(initializeStatus)
        guard initializeStatus >= 0 else { return }
        applyPreferredAudioLanguage()

        for (index, property) in [
            (1, "pause"),
            (2, "paused-for-cache"),
            (3, "core-idle"),
            (4, "eof-reached"),
            (5, "seeking"),
            (6, "track-list/count"),
        ] {
            mpv_observe_property(mpv, UInt64(index), property, property == "track-list/count" ? MPV_FORMAT_INT64 : MPV_FORMAT_FLAG)
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

    private func attemptStartPendingLoad() {
        guard let request = pendingLoad, mpv != nil else { return }
        guard let window = viewIfLoaded?.window else {
            schedulePendingRetry()
            return
        }

        let surfaceSize = externallyManagedViewSize ?? view.bounds.size
        guard surfaceSize.width > 1, surfaceSize.height > 1 else {
            schedulePendingRetry()
            return
        }

        let windowArea = window.bounds.width * window.bounds.height
        let screenBounds = window.screen.bounds
        let screenArea = screenBounds.width * screenBounds.height
        let isWindowedIpad = UIDevice.current.userInterfaceIdiom == .pad
            && windowArea < screenArea * 0.98
        let isSettledLandscape = surfaceSize.width > surfaceSize.height
            && window.windowScene?.interfaceOrientation.isLandscape == true
        guard isWindowedIpad || isSettledLandscape else {
            schedulePendingRetry()
            return
        }

        // Full-screen playback waits for landscape to settle before MPV creates
        // its video output. iPad multitasking windows may legitimately remain
        // taller than wide, so their current drawable is already the final one.
        layoutMetalLayer()
        pendingLoad = nil
        pendingRetry?.cancel()
        pendingRetry = nil
        startLoad(request)
    }

    private func startLoad(_ request: ConduitPendingLoad) {
        guard mpv != nil else { return }
        layoutMetalLayer()
        pictureInPictureClock.reset(positionMs: request.initialPositionMs)
        clearError()
        activeHeaders = sanitizeHeaders(request.headers)
        applyRequestHeaders(activeHeaders)
        cancelVideoOutputWatchdog()
        cancelVideoOutputRecovery(resetAttempts: true)
        videoOutputRecoveryState = ConduitVideoOutputRecoveryState()
        resetVideoOutputObservations()
        hasLoadedFile = false
        hasVideoStream = false
        isPlayerLoading = true
        isPlayerEnded = false
        waitingForInitialVideoFrame = true
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
        let subtitles = pendingExternalSubtitles
        pendingExternalSubtitles.removeAll(keepingCapacity: true)
        guard !subtitles.isEmpty else { return }

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

    private func layoutMetalLayer() {
        guard !destroyStarted else { return }

        // The Compose size callback is expressed through Compose density, which
        // can differ slightly from UIKit's native pixel scale. Using it for the
        // Metal drawable can therefore make MPV's render target a few pixels
        // larger than the CAMetalDrawable attachment during interactive resize.
        // UIKit's bounds are the authoritative dimensions of the embedded view.
        let bounds = CGRect(origin: .zero, size: view.bounds.size)
        guard bounds.width > 1, bounds.height > 1 else { return }
        if videoSurfaceSize != bounds.size {
            videoSurfaceSize = bounds.size
            updateSubtitlePosition()
        }
        let scale = view.window?.screen.nativeScale ?? UIScreen.main.nativeScale
        let size = CGSize(
            width: (bounds.width * scale).rounded(),
            height: (bounds.height * scale).rounded()
        )
        if lastDrawableSize != .zero && size != lastDrawableSize {
            noteSurfaceGeometryChange()
        }

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        metalLayer.contentsScale = scale
        metalLayer.position = .zero
        if lastDrawableSize == .zero {
            applyDrawableSize(size, bounds: bounds)
        } else if size == lastDrawableSize {
            pendingDrawableResize?.cancel()
            pendingDrawableResize = nil
            pendingDrawableSize = nil
            pendingDrawableBounds = nil
            settleMetalBounds(bounds)
            updateLiveResizeState()
        } else if interactiveResizeActive {
            pendingDrawableResize?.cancel()
            pendingDrawableResize = nil
            pendingDrawableSize = size
            pendingDrawableBounds = bounds
            showStableSurface(in: bounds)
            updateLiveResizeState()
        } else if ConduitSurfaceTransitionPolicy.shouldScheduleDrawableResize(
            size: size,
            pendingSize: pendingDrawableSize,
            hasPendingResize: pendingDrawableResize != nil
        ) {
            pendingDrawableResize?.cancel()
            pendingDrawableSize = size
            pendingDrawableBounds = bounds
            showStableSurface(in: bounds)
            updateLiveResizeState()
            let resize = DispatchWorkItem { [weak self] in
                guard let self,
                      self.pendingDrawableSize == size,
                      self.pendingDrawableBounds == bounds
                else { return }
                // Transition ownership, rather than this timer, decides when
                // the new drawable may be handed to MoltenVK.
                _ = self.applyPendingDrawableResizeIfSettled()
            }
            pendingDrawableResize = resize
            // MoltenVK must rebuild its swapchain before rendering at the new
            // attachment size. Coalescing interactive changes prevents it from
            // rendering a previous, larger target into a newer small drawable.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: resize)
        }
        CATransaction.commit()
    }

    private func showStableSurface(in desiredBounds: CGRect) {
        guard settledMetalBounds.width > 1, settledMetalBounds.height > 1 else { return }
        let scaleX = desiredBounds.width / settledMetalBounds.width
        let scaleY = desiredBounds.height / settledMetalBounds.height
        metalLayer.bounds = settledMetalBounds
        metalLayer.setAffineTransform(CGAffineTransform(scaleX: scaleX, y: scaleY))
    }

    private func settleMetalBounds(_ bounds: CGRect) {
        metalLayer.setAffineTransform(.identity)
        metalLayer.bounds = bounds
        settledMetalBounds = bounds
    }

    private func applyDrawableSize(_ size: CGSize, bounds: CGRect) {
#if DEBUG
        print(
            "[Conduit MPV][surface] points=\(Int(bounds.width))x\(Int(bounds.height)) " +
            "drawable=\(Int(size.width))x\(Int(size.height))"
        )
#endif
        settleMetalBounds(bounds)
        metalLayer.drawableSize = size
        lastDrawableSize = size
        lastObservedDrawableHeartbeat = metalLayer.drawableHeartbeatSnapshot().count
        debugLog(
            "surface applied points=\(Int(bounds.width))x\(Int(bounds.height)) " +
                "drawable=\(Int(size.width))x\(Int(size.height))"
        )
        scheduleVideoOutputWatchdog()
    }

    private func syncVideoSurfaceLayout() {
        runOnMain { [weak self] in
            self?.syncVideoSurfaceLayoutNow(scheduleDeferredPasses: true)
        }
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
        // Compose owns the embedded controller's view geometry. Forcing its
        // frame or an immediate UIKit layout here can recursively lay out
        // Compose's hidden input view while the app is entering the foreground.
        view.setNeedsLayout()
        layoutMetalLayer()

        guard scheduleDeferredPasses else { return }
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll(keepingCapacity: true)
        [0.0, 0.05, 0.15, 0.35].forEach { delay in
            let workItem = DispatchWorkItem { [weak self] in
                self?.layoutMetalLayer()
            }
            pendingSurfaceLayoutWorkItems.append(workItem)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
        }
    }

    /// MPV's crop modes enlarge the video rectangle, which can move bottom
    /// subtitles outside the visible surface. Keep the subtitle's source
    /// position inside that cropped rectangle by translating it upward by the
    /// amount of vertical crop. `video-zoom` is logarithmic in MPV, so mode 2
    /// uses the corresponding power-of-two scale factor.
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
                    let tracksChanged = event.pointee.reply_userdata == 6
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
                        self.scheduleVideoOutputWatchdog()
                    }
                case MPV_EVENT_PLAYBACK_RESTART:
                    DispatchQueue.main.async { [weak self] in
                        self?.refreshPlaybackState()
                        self?.scheduleVideoOutputWatchdog()
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
                selected: getFlag("track-list/\(index)/selected")
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
        seeking: Bool,
        drawable: (count: UInt64, uptime: TimeInterval)
    ) {
        let snapshot = [
            String(format: "position=%.3f", position),
            "paused=\(paused)",
            "cachePaused=\(cachePaused)",
            "coreIdle=\(coreIdle)",
            "seeking=\(seeking)",
            "transition=\(isSurfaceTransitionInProgress)",
            "drawable=\(drawable.count)",
            "playingIntent=\(shouldPlay)",
            "video=\(videoWidth)x\(videoHeight)",
            "errorPresent=\(!currentErrorMessage.isEmpty)",
            "settled=\(Int(settledMetalBounds.width))x\(Int(settledMetalBounds.height))",
            "scale=\(String(format: "%.2f", Double(metalLayer.contentsScale)))",
            "rebind=\(videoOutputRecoveryState.result.rawValue)",
            "recoveryAttempts=\(videoOutputRecoveryState.attempts)",
            "recoveryElapsed=\(recoveryElapsedDescription)",
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

    private var recoveryElapsedDescription: String {
        guard let started = videoOutputRecoveryState.startedAt else { return "none" }
        return String(format: "%.2f", ProcessInfo.processInfo.systemUptime - started)
    }

    private func runOnMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }

    private func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        Self.audioSessionQueue.async {
            do {
                try session.setCategory(.playback, mode: .moviePlayback)
                try session.setActive(true)
            } catch {
                print("[Conduit MPV] Failed to activate audio session: \(error)")
            }
        }
    }

    private func deactivateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        Self.audioSessionQueue.async {
            do {
                try session.setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                print("[Conduit MPV] Failed to deactivate audio session: \(error)")
            }
        }
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

/// Mirrors MPV's final Metal drawable into AVKit without creating a second decoder.
/// Frame copying and cadence scheduling live in ConduitPictureInPictureFrameCapture.
final class ConduitPictureInPictureCoordinator: NSObject,
    AVPictureInPictureControllerDelegate,
    AVPictureInPictureSampleBufferPlaybackDelegate {
    private weak var owner: ConduitMPVPlayerViewController?
    private let metalLayer: ConduitMetalLayer
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var frameCapture: ConduitPictureInPictureFrameCapture!
    private var controller: AVPictureInPictureController?
    private var pictureInPicturePossibleObservation: NSKeyValueObservation?
    private var priming = false
    private var startRequested = false
    private var startAttempts = 0
    private var startAttemptWorkItem: DispatchWorkItem?
    private var enqueuedFrameCount = 0
    private var primingStartHopScheduled = false
    private let primingStateLock = NSLock()
    private var primingTimeout: DispatchWorkItem?
    private var captureReprimeAttempts = 0

    init(owner: ConduitMPVPlayerViewController, metalLayer: ConduitMetalLayer) {
        self.owner = owner
        self.metalLayer = metalLayer
        super.init()
        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = UIColor.black.cgColor
        owner.view.layer.insertSublayer(displayLayer, at: 0)
        let source = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: displayLayer,
            playbackDelegate: self
        )
        let controller = AVPictureInPictureController(contentSource: source)
        controller.delegate = self
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        self.controller = controller
        frameCapture = ConduitPictureInPictureFrameCapture(
            metalLayer: metalLayer,
            displayLayer: displayLayer,
            clockProvider: { [weak owner] in
                owner?.pictureInPictureClock.snapshot() ?? .empty
            },
            onFrameEnqueued: {}
        )
        frameCapture.setOnFrameEnqueued { [weak self] in
            self?.frameWasEnqueued()
        }
        frameCapture.setOnCaptureFailure { [weak self] reason, kind in
            self?.frameCaptureFailed(reason, kind: kind)
        }
        metalLayer.onDrawablePresented = { [weak self] drawable, presentationID in
            self?.frameCapture.handlePresentedDrawable(drawable, presentationID: presentationID)
        }
        pictureInPicturePossibleObservation = controller.observe(
            \.isPictureInPicturePossible,
            options: [.initial, .new]
        ) { [weak self] _, change in
            guard change.newValue == true else { return }
            DispatchQueue.main.async { self?.attemptStart() }
        }
    }

    var isSupported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }
    var isActive: Bool {
        controller?.isPictureInPictureActive == true || controller?.isPictureInPictureSuspended == true
    }
    var isStartingOrActive: Bool { priming || isActive }

    func layout(in bounds: CGRect) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        displayLayer.frame = bounds
        CATransaction.commit()
    }

    func start() {
        guard isSupported, !isActive, !priming else { return }
        captureReprimeAttempts = 0
        setStartRequested(true)
        beginPriming()
        attemptStart()
    }

    func prepareForAutomaticEntry() {
        guard isSupported, owner?.isPlayerPlaying == true, !isActive, !priming else { return }
        captureReprimeAttempts = 0
        setStartRequested(false)
        beginPriming(capturesWithoutPresentation: true)
    }

    func stop() {
        if priming && !isActive {
            priming = false
            setStartRequested(false)
            stopCapture()
            owner?.restoreVideoAfterPictureInPictureStopIfNeeded()
            owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
        }
        controller?.stopPictureInPicture()
    }

    func stopForNewLoad() {
        captureReprimeAttempts = 0
        priming = false
        setStartRequested(false)
        stopCapture()
        displayLayer.flushAndRemoveImage()
        controller?.stopPictureInPicture()
    }

    func playbackStateChanged() {
        controller?.invalidatePlaybackState()
    }

    func timelineDidSeek() {
        displayLayer.flush()
        resetPrimingFrameState()
        frameCapture.resetTimeline()
    }

    func invalidate() {
        pictureInPicturePossibleObservation?.invalidate()
        pictureInPicturePossibleObservation = nil
        stopCapture()
        metalLayer.onDrawablePresented = nil
        controller?.stopPictureInPicture()
        controller?.delegate = nil
        controller = nil
        displayLayer.flushAndRemoveImage()
        displayLayer.removeFromSuperlayer()
    }

    private func beginPriming(capturesWithoutPresentation: Bool = false) {
        guard !priming else { return }
        owner?.suspendVideoOutputWatchdogForPictureInPicture()
        priming = true
        startAttempts = 0
        resetPrimingFrameState()
        startAttemptWorkItem?.cancel()
        startAttemptWorkItem = nil
        displayLayer.flush()
        // This selector is a contract for a future/patched MPVKit renderer.
        // The pinned package still requires normal drawable presentation, so
        // automatic background entry cannot be considered fully supported.
        metalLayer.capturesWithoutPresentation = capturesWithoutPresentation
        metalLayer.isDrawableCaptureArmed = true
        frameCapture.start()
        schedulePrimingTimeout()
    }

    private func stopCapture() {
        primingTimeout?.cancel()
        primingTimeout = nil
        startAttemptWorkItem?.cancel()
        startAttemptWorkItem = nil
        resetPrimingFrameState()
        metalLayer.isDrawableCaptureArmed = false
        metalLayer.capturesWithoutPresentation = false
        frameCapture.stop()
    }

    private func schedulePrimingTimeout() {
        primingTimeout?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.priming, !self.isActive else { return }
            print("[Conduit PiP] Timed out waiting for priming frames")
            self.priming = false
            self.setStartRequested(false)
            self.stopCapture()
            self.owner?.restoreVideoAfterPictureInPictureStopIfNeeded()
            self.owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
        }
        primingTimeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    private func frameCaptureFailed(_ reason: String, kind: ConduitPipCaptureFailureKind) {
        let work = { [weak self] in
            guard let self, self.priming || self.isActive else { return }
            print("[Conduit PiP] Frame capture failed: \(reason)")
            let wasActive = self.isActive

            if kind == .rePrime,
               !wasActive,
               self.captureReprimeAttempts < 1 {
                self.captureReprimeAttempts += 1
                let capturesWithoutPresentation = self.metalLayer.capturesWithoutPresentation
                self.priming = false
                self.stopCapture()
                self.beginPriming(capturesWithoutPresentation: capturesWithoutPresentation)
                return
            }

            self.priming = false
            self.setStartRequested(false)
            self.stopCapture()
            self.owner?.setInlineVideoHiddenForPictureInPicture(false)
            if wasActive {
                self.controller?.stopPictureInPicture()
                self.owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
            } else {
                self.owner?.restoreVideoAfterPictureInPictureStopIfNeeded()
                self.owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
            }
        }
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    private func frameWasEnqueued() {
        guard shouldSchedulePrimingStart() else { return }
        // AVKit start requests must run on main, but this hop happens only
        // once when the second priming frame arrives, never for active PiP
        // frames.
        DispatchQueue.main.async { [weak self] in
            self?.attemptStart()
        }
    }

    private var isStartRequested: Bool {
        primingStateLock.lock()
        defer { primingStateLock.unlock() }
        return startRequested
    }

    private func setStartRequested(_ requested: Bool) {
        primingStateLock.lock()
        startRequested = requested
        if !requested { primingStartHopScheduled = false }
        primingStateLock.unlock()
    }

    private func resetPrimingFrameState() {
        primingStateLock.lock()
        enqueuedFrameCount = 0
        primingStartHopScheduled = false
        primingStateLock.unlock()
    }

    private func shouldSchedulePrimingStart() -> Bool {
        primingStateLock.lock()
        enqueuedFrameCount += 1
        let shouldSchedule = startRequested
            && enqueuedFrameCount == 2
            && !primingStartHopScheduled
        if shouldSchedule { primingStartHopScheduled = true }
        primingStateLock.unlock()
        return shouldSchedule
    }

    private func clearPrimingStartHop() {
        primingStateLock.lock()
        primingStartHopScheduled = false
        primingStateLock.unlock()
    }

    private func primingFrameState() -> (startRequested: Bool, enqueuedFrameCount: Int) {
        primingStateLock.lock()
        defer { primingStateLock.unlock() }
        return (startRequested, enqueuedFrameCount)
    }

    private func attemptStart() {
        clearPrimingStartHop()
        let (startRequested, enqueuedFrameCount) = primingFrameState()
        guard startRequested, let controller, !controller.isPictureInPictureActive else { return }
        guard enqueuedFrameCount >= 2 else { return }
        guard startAttemptWorkItem == nil else { return }
        if controller.isPictureInPicturePossible {
            let work = DispatchWorkItem { [weak self, weak controller] in
                guard let self, let controller else { return }
                self.startAttemptWorkItem = nil
                guard self.isStartRequested,
                      controller.isPictureInPicturePossible,
                      !controller.isPictureInPictureActive
                else {
                    self.attemptStart()
                    return
                }
                self.setStartRequested(false)
                controller.invalidatePlaybackState()
                CATransaction.flush()
                controller.startPictureInPicture()
            }
            startAttemptWorkItem = work
            // Let the second priming frame commit before asking Pegasus to
            // detach the display layer into its system window.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: work)
            return
        }
        guard startAttempts < 20 else {
            setStartRequested(false)
            priming = false
            stopCapture()
            owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
            return
        }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.startAttemptWorkItem = nil
            self.startAttempts += 1
            self.attemptStart()
        }
        startAttemptWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: work)
    }

    func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        primingTimeout?.cancel()
        primingTimeout = nil
        metalLayer.capturesWithoutPresentation = true
        owner?.setInlineVideoHiddenForPictureInPicture(true)
    }

    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        priming = false
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        print("[Conduit PiP] Failed to start: \(error)")
        owner?.setInlineVideoHiddenForPictureInPicture(false)
        priming = false
        setStartRequested(false)
        stopCapture()
        owner?.restoreVideoAfterPictureInPictureStopIfNeeded()
        owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        owner?.setInlineVideoHiddenForPictureInPicture(false)
        priming = false
        setStartRequested(false)
        stopCapture()
        owner?.restoreVideoAfterPictureInPictureStopIfNeeded()
        owner?.resumeVideoOutputWatchdogAfterPictureInPicture()
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(true)
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        setPlaying playing: Bool
    ) {
        playing ? owner?.playPlayback() : owner?.pausePlayback()
    }

    func pictureInPictureControllerTimeRangeForPlayback(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> CMTimeRange {
        let duration = CMTime(value: max(owner?.durationMs ?? 0, 1), timescale: 1_000)
        return CMTimeRange(start: .zero, duration: duration)
    }

    func pictureInPictureControllerIsPlaybackPaused(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> Bool {
        owner?.isPlayerPlaying != true
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
        owner?.seekByMs(Int64(CMTimeGetSeconds(skipInterval) * 1_000))
        completionHandler()
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
