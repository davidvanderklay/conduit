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
    // Audio route changes can block. Serialize them across player instances
    // without making the Compose/UIKit thread wait for the system audio route.
    private static let audioSessionQueue = DispatchQueue(label: "media.conduit.audio-session", qos: .userInitiated)

    private let eventQueue = DispatchQueue(label: "media.conduit.mpv-events", qos: .userInitiated)
    private let subtitleQueue = DispatchQueue(label: "media.conduit.mpv-subtitles", qos: .utility)
    private let subtitleLock = NSLock()
    private let errorLock = NSLock()
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
    private var backgroundedWithPictureInPicture = false
    private var lastDrawableSize: CGSize = .zero
    private var externallyManagedViewSize: CGSize?
    private var pendingSurfaceLayoutWorkItems: [DispatchWorkItem] = []
    private var pendingDrawableResize: DispatchWorkItem?
    private var pendingDrawableSize: CGSize?
    private var interactiveResizeActive = false
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var recentErrors: [String] = []
    private var playbackError: String?
    private var waitingForInitialVideoFrame = false
    private var pendingExternalSubtitles: [ConduitSubtitle] = []
    private var subtitleLoadGeneration = 0
    private var loadStartedAtUptime: TimeInterval = 0
    private var destroyStarted = false

    fileprivate var audioTracks: [ConduitTrack] = []
    fileprivate var subtitleTracks: [ConduitTrack] = []
    var isPlayerLoading = true
    var isPlayerBuffering = false
    var isPlayerPlaying = false
    var isPlayerEnded = false
    var durationMs: Int64 = 0
    var positionMs: Int64 = 0
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
            self?.enterBackground()
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.enterForeground() })
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

    func setInteractiveResize(_ active: Bool) {
        runOnMain { [weak self] in
            guard let self, self.interactiveResizeActive != active else { return }
            self.interactiveResizeActive = active
            self.pendingDrawableResize?.cancel()
            self.pendingDrawableResize = nil
            if !active { self.layoutMetalLayer() }
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
            pendingLoad = request
            attemptStartPendingLoad()
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.pendingLoad = request
                self?.attemptStartPendingLoad()
            }
        }
    }

    func playPlayback() {
        runOnMain { [weak self] in
            guard let self else { return }
            self.shouldPlay = true
            guard self.mpv != nil, !self.waitingForInitialVideoFrame else { return }
            self.setFlag("pause", false)
            self.isPlayerPlaying = true
            self.refreshPlaybackState()
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func pausePlayback() {
        runOnMain { [weak self] in
            guard let self else { return }
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
            self.command("seek", args: [String(format: "%.3f", Double(milliseconds) / 1000.0), "absolute"])
            self.pictureInPicture?.playbackStateChanged()
        }
    }

    func seekByMs(_ milliseconds: Int64) {
        runOnMain { [weak self] in
            guard let self, self.mpv != nil else { return }
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
            guard let self, self.mpv != nil else { return }
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
        }
        let duration = getDouble("duration")
        let position = getDouble("time-pos")
        let speed = getDouble("speed")
        let paused = getFlag("pause")
        let eofReached = getFlag("eof-reached")
        let idle = getFlag("core-idle")
        let seeking = getFlag("seeking")
        let buffering = getFlag("paused-for-cache")

        _ = mpv
        isPlayerBuffering = hasLoadedFile
            && !waitingForInitialVideoFrame
            && shouldPlay
            && !paused
            && !eofReached
            && (buffering || idle || seeking)
        isPlayerLoading = waitingForInitialVideoFrame || !hasLoadedFile

        // `core-idle` and `paused-for-cache` describe MPV's temporary ability
        // to advance, not the user's play/pause intent. Keeping the UI in the
        // playing state lets MPV resume itself after the cache refills and
        // prevents a Play tap from fighting that automatic resume.
        isPlayerPlaying = hasLoadedFile
            && !waitingForInitialVideoFrame
            && shouldPlay
            && !paused
            && !eofReached
        isPlayerEnded = eofReached
        durationMs = Int64(max(duration, 0) * 1000)
        positionMs = Int64(max(position, 0) * 1000)
        currentSpeed = Float(speed > 0 ? speed : 1.0)
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

        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        lifecycleObservers.removeAll()
        pendingRetry?.cancel()
        pendingRetry = nil
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll()
        pendingDrawableResize?.cancel()
        pendingDrawableResize = nil
        pendingDrawableSize = nil
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
            return
        }
        backgroundedWithPictureInPicture = false
        resumeAfterForeground = isPlayerPlaying || shouldPlay
        pendingRetry?.cancel()
        pendingRetry = nil
        pendingSurfaceLayoutWorkItems.forEach { $0.cancel() }
        pendingSurfaceLayoutWorkItems.removeAll()
        pendingDrawableResize?.cancel()
        pendingDrawableResize = nil
        pendingDrawableSize = nil
        pausePlayback()
        setStringProperty("vid", "no")
    }

    private func enterForeground() {
        guard mpv != nil else { return }
        if backgroundedWithPictureInPicture && pictureInPicture?.isActive == true {
            pictureInPicture?.stop()
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
        clearError()
        activeHeaders = sanitizeHeaders(request.headers)
        applyRequestHeaders(activeHeaders)
        hasLoadedFile = false
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
        // The Compose size callback is expressed through Compose density, which
        // can differ slightly from UIKit's native pixel scale. Using it for the
        // Metal drawable can therefore make MPV's render target a few pixels
        // larger than the CAMetalDrawable attachment during interactive resize.
        // UIKit's bounds are the authoritative dimensions of the embedded view.
        let bounds = CGRect(origin: .zero, size: view.bounds.size)
        guard bounds.width > 1, bounds.height > 1 else { return }
        let scale = view.window?.screen.nativeScale ?? UIScreen.main.nativeScale
        let size = CGSize(
            width: (bounds.width * scale).rounded(),
            height: (bounds.height * scale).rounded()
        )

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        metalLayer.contentsScale = scale
        metalLayer.position = .zero
        metalLayer.bounds = bounds
        if lastDrawableSize == .zero {
            applyDrawableSize(size)
        } else if size == lastDrawableSize {
            pendingDrawableResize?.cancel()
            pendingDrawableResize = nil
            pendingDrawableSize = nil
        } else if interactiveResizeActive {
            pendingDrawableResize?.cancel()
            pendingDrawableResize = nil
            pendingDrawableSize = size
        } else if size != pendingDrawableSize || pendingDrawableResize == nil {
            pendingDrawableResize?.cancel()
            pendingDrawableSize = size
            let resize = DispatchWorkItem { [weak self] in
                guard let self, self.pendingDrawableSize == size else { return }
                self.pendingDrawableResize = nil
                self.pendingDrawableSize = nil
                self.applyDrawableSize(size)
            }
            pendingDrawableResize = resize
            // MoltenVK must rebuild its swapchain before rendering at the new
            // attachment size. Coalescing interactive changes prevents it from
            // rendering a previous, larger target into a newer small drawable.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: resize)
        }
        CATransaction.commit()
    }

    private func applyDrawableSize(_ size: CGSize) {
#if DEBUG
        print(
            "[Conduit MPV][surface] points=\(Int(metalLayer.bounds.width))x\(Int(metalLayer.bounds.height)) " +
            "drawable=\(Int(size.width))x\(Int(size.height))"
        )
#endif
        metalLayer.drawableSize = size
        lastDrawableSize = size
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
        guard isViewLoaded else { return }
        if let size, size.width > 1, size.height > 1 {
            externallyManagedViewSize = size
        }
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
                        if self.getString("video-codec") == nil {
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
/// The copier is bounded to 20 fps and one in-flight frame; late frames are dropped.
final class ConduitPictureInPictureCoordinator: NSObject,
    AVPictureInPictureControllerDelegate,
    AVPictureInPictureSampleBufferPlaybackDelegate {
    private weak var owner: ConduitMPVPlayerViewController?
    private let metalLayer: ConduitMetalLayer
    private let displayLayer = AVSampleBufferDisplayLayer()
    private let captureQueue = DispatchQueue(label: "media.conduit.pip-capture", qos: .userInitiated)
    private var controller: AVPictureInPictureController?
    private var pictureInPicturePossibleObservation: NSKeyValueObservation?
    private var displayLink: CADisplayLink?
    private var pixelBufferPool: CVPixelBufferPool?
    private var formatDescription: CMVideoFormatDescription?
    private var poolSize = CGSize.zero
    private var captureInFlight = false
    private var priming = false
    private var startRequested = false
    private var startAttempts = 0
    private var startAttemptWorkItem: DispatchWorkItem?
    private var enqueuedFrameCount = 0
    private var lastTimestamp = CMTime.invalid
    private var automaticEntryTimeout: DispatchWorkItem?

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
        guard isSupported, !isActive else { return }
        startRequested = true
        beginPriming()
        attemptStart()
    }

    func prepareForAutomaticEntry() {
        guard isSupported, owner?.isPlayerPlaying == true, !isActive else { return }
        startRequested = false
        beginPriming()
        automaticEntryTimeout?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.isActive else { return }
            self.priming = false
            self.stopCapture()
            self.owner?.pausePlayback()
        }
        automaticEntryTimeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    func stop() {
        controller?.stopPictureInPicture()
    }

    func playbackStateChanged() {
        controller?.invalidatePlaybackState()
    }

    func invalidate() {
        automaticEntryTimeout?.cancel()
        automaticEntryTimeout = nil
        pictureInPicturePossibleObservation?.invalidate()
        pictureInPicturePossibleObservation = nil
        stopCapture()
        controller?.delegate = nil
        controller = nil
        displayLayer.flushAndRemoveImage()
        displayLayer.removeFromSuperlayer()
    }

    private func beginPriming() {
        priming = true
        startAttempts = 0
        enqueuedFrameCount = 0
        startAttemptWorkItem?.cancel()
        startAttemptWorkItem = nil
        lastTimestamp = .invalid
        displayLayer.flush()
        if displayLink == nil {
            let link = CADisplayLink(target: self, selector: #selector(captureTick))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: 20, preferred: 20)
            link.add(to: .main, forMode: .common)
            displayLink = link
        }
    }

    private func stopCapture() {
        startAttemptWorkItem?.cancel()
        startAttemptWorkItem = nil
        displayLink?.invalidate()
        displayLink = nil
        captureInFlight = false
        pixelBufferPool = nil
        formatDescription = nil
        poolSize = .zero
        lastTimestamp = .invalid
        enqueuedFrameCount = 0
    }

    @objc private func captureTick() {
        if displayLayer.status == .failed { displayLayer.flush() }
        guard priming || isActive, !captureInFlight, displayLayer.isReadyForMoreMediaData else { return }
        guard let owner else { return }
        let sourceSize = metalLayer.drawableSize
        guard sourceSize.width > 1, sourceSize.height > 1 else { return }
        ensurePool(for: sourceSize)
        guard let pixelBufferPool else { return }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pixelBufferPool, &buffer) == kCVReturnSuccess,
              let buffer
        else { return }

        captureInFlight = true
        let requestedTimestamp = CMTime(value: max(owner.positionMs, 0), timescale: 1_000)
        let minimumNext = lastTimestamp.isValid
            ? CMTimeAdd(lastTimestamp, CMTime(value: 1, timescale: 20))
            : requestedTimestamp
        let timestamp = CMTimeCompare(requestedTimestamp, minimumNext) < 0 ? minimumNext : requestedTimestamp
        captureQueue.async { [weak self] in
            guard let self else { return }
            let copied = self.metalLayer.copyLatestFrame(to: buffer)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.captureInFlight = false
                guard copied, let formatDescription = self.formatDescription else { return }
                var timing = CMSampleTimingInfo(
                    duration: CMTime(value: 1, timescale: 20),
                    presentationTimeStamp: timestamp,
                    decodeTimeStamp: .invalid
                )
                var sample: CMSampleBuffer?
                guard CMSampleBufferCreateReadyWithImageBuffer(
                    allocator: kCFAllocatorDefault,
                    imageBuffer: buffer,
                    formatDescription: formatDescription,
                    sampleTiming: &timing,
                    sampleBufferOut: &sample
                ) == noErr, let sample else { return }
                CMSetAttachment(
                    sample,
                    key: kCMSampleAttachmentKey_DisplayImmediately,
                    value: kCFBooleanTrue,
                    attachmentMode: kCMAttachmentMode_ShouldPropagate
                )
                self.lastTimestamp = timestamp
                self.displayLayer.enqueue(sample)
                self.enqueuedFrameCount += 1
                if self.startRequested { self.attemptStart() }
            }
        }
    }

    private func ensurePool(for sourceSize: CGSize) {
        let scale = min(1, 1280 / sourceSize.width, 720 / sourceSize.height)
        let width = max(2, Int((sourceSize.width * scale).rounded()) & ~1)
        let height = max(2, Int((sourceSize.height * scale).rounded()) & ~1)
        let size = CGSize(width: width, height: height)
        guard size != poolSize else { return }

        var pool: CVPixelBufferPool?
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
            kCVPixelBufferMetalCompatibilityKey: true,
        ]
        guard CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool) == kCVReturnSuccess,
              let pool
        else { return }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
              let buffer
        else { return }
        var description: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: buffer,
            formatDescriptionOut: &description
        ) == noErr else { return }
        pixelBufferPool = pool
        formatDescription = description
        poolSize = size
        displayLayer.flush()
    }

    private func attemptStart() {
        guard startRequested, let controller, !controller.isPictureInPictureActive else { return }
        guard enqueuedFrameCount >= 2 else { return }
        guard startAttemptWorkItem == nil else { return }
        if controller.isPictureInPicturePossible {
            let work = DispatchWorkItem { [weak self, weak controller] in
                guard let self, let controller else { return }
                self.startAttemptWorkItem = nil
                guard self.startRequested,
                      controller.isPictureInPicturePossible,
                      !controller.isPictureInPictureActive
                else {
                    self.attemptStart()
                    return
                }
                self.startRequested = false
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
            startRequested = false
            priming = false
            stopCapture()
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
        automaticEntryTimeout?.cancel()
        automaticEntryTimeout = nil
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
        startRequested = false
        stopCapture()
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        owner?.setInlineVideoHiddenForPictureInPicture(false)
        priming = false
        startRequested = false
        stopCapture()
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
