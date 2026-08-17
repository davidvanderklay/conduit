import AVFoundation
import AVKit
import ComposeApp
import Foundation
import KSPlayer
import UIKit

fileprivate struct ConduitKSSubtitlePayload: Decodable {
    let id: String?
    let url: String
    let lang: String?
    let addonName: String?
}

fileprivate struct ConduitKSPlayerTrack {
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

/// KSPlayer implementation of the shared iOS player boundary.
///
/// Compose continues to own all controls. KSPlayer owns decoding, rendering,
/// native subtitle composition, remote controls, audio-session handling, and
/// the native PiP controller.
final class ConduitKSPlayerBridge: NSObject, IosPlayerBridge {
    private var playerViewController: ConduitKSPlayerViewController?
    private var holdsLandscapeLock = false
    private var playbackRegistered = true

    override init() {
        super.init()
        KSOptions.canBackgroundPlay = true
        ConduitOrientationCoordinator.shared.beginPlayback()
    }

    func createPlayerViewController() -> UIViewController {
        if let playerViewController {
            return playerViewController
        }
        let controller = ConduitKSPlayerViewController()
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

    // KSPlayer owns its video surface and does not need MPVKit's Metal
    // watchdog/recovery path. Retrying an errored layer still re-enters its
    // normal preparation flow for the shared retry command.
    func retryVideoOutput() { playerViewController?.retryPlayback() }

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
        playerViewController?.isPictureInPictureSupported ?? false
    }

    func isPictureInPictureActive() -> Bool {
        playerViewController?.isPictureInPictureActive ?? false
    }

    func startPictureInPicture() { playerViewController?.startPictureInPicture() }
    func stopPictureInPicture() { playerViewController?.stopPictureInPicture() }

    func syncVideoSurfaceLayout(width: Double, height: Double) {
        playerViewController?.syncVideoSurfaceLayout(CGSize(width: width, height: height))
    }

    func setInteractiveResize(active: Bool) {
        playerViewController?.setInteractiveResize(active)
    }

    func getAudioTrackCount() -> Int32 {
        Int32(playerViewController?.audioTracks.count ?? 0)
    }

    func getAudioTrackId(at: Int32) -> Int32 {
        Int32(track(at: at, in: playerViewController?.audioTracks)?.id ?? 0)
    }

    func getAudioTrackLabel(at: Int32) -> String {
        track(at: at, in: playerViewController?.audioTracks)?.title ?? ""
    }

    func getAudioTrackLang(at: Int32) -> String {
        track(at: at, in: playerViewController?.audioTracks)?.language ?? ""
    }

    func getAudioTrackLanguageName(at: Int32) -> String {
        guard let language = track(at: at, in: playerViewController?.audioTracks)?.language else { return "" }
        let code = language.replacingOccurrences(of: "_", with: "-").split(separator: "-").first.map(String.init) ?? ""
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
        Int32(track(at: at, in: playerViewController?.subtitleTracks)?.id ?? 0)
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

    private func ensurePlayerViewController() -> ConduitKSPlayerViewController {
        if let playerViewController {
            return playerViewController
        }
        let controller = ConduitKSPlayerViewController()
        playerViewController = controller
        return controller
    }

    private func track(at index: Int32, in tracks: [ConduitKSPlayerTrack]?) -> ConduitKSPlayerTrack? {
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

    private func parseSubtitles(_ json: String?) -> [ConduitKSSubtitlePayload] {
        guard
            let json,
            let data = json.data(using: .utf8),
            let subtitles = try? JSONDecoder().decode([ConduitKSSubtitlePayload].self, from: data)
        else { return [] }
        return subtitles.filter { !$0.url.isEmpty }
    }
}

/// KSPlayer's native view is used only for rendering and subtitle composition.
/// Its built-in transport UI stays hidden because Compose is the app's source
/// of truth for controls and gestures.
final class ConduitKSPlayerView: VideoPlayerView {
    override func customizeUIComponents() {
        // KSPlayer's phone default is 16pt. MPVKit renders subtitles closer
        // to the size users expect from the rest of the app, so use the
        // larger native preset before VideoPlayerView creates its subtitle UI.
        SubtitleModel.textFontSize = 24
        super.customizeUIComponents()
        hideBuiltInControls()
    }

    private func hideBuiltInControls() {
        controllerView.isHidden = true
        controllerView.isUserInteractionEnabled = false
        topMaskView.isHidden = true
        bottomMaskView.isHidden = true
        replayButton.isHidden = true
        lockButton.isHidden = true
        speedTipLabel.isHidden = true
        loadingIndector.isHidden = true
    }
}

final class ConduitKSPlayerViewController: UIViewController {
    private let playerView = ConduitKSPlayerView(frame: .zero)
    private var preferredAudioLanguage = "System default"
    private var preferredSubtitleLanguage = "English"
    private var externalSubtitleLanguages: [String: String] = [:]
    private var userSelectedSubtitle = false
    private var didApplyPreferredTracks = false

    fileprivate var audioTracks: [ConduitKSPlayerTrack] {
        guard let player = playerView.playerLayer?.player else { return [] }
        return player.tracks(mediaType: .audio).enumerated().map { index, track in
            let description = String(describing: track)
            let asbd = track.audioStreamBasicDescription
            return ConduitKSPlayerTrack(
                id: Int(track.trackID),
                title: track.name.isEmpty ? "Audio \(index + 1)" : track.name,
                language: track.languageCode ?? "",
                codec: description,
                channels: asbd.map { String($0.mChannelsPerFrame) } ?? "",
                channelCount: asbd.map { Int($0.mChannelsPerFrame) } ?? 0,
                sampleRate: asbd.map { Int($0.mSampleRate) } ?? 0,
                bitrate: track.bitRate,
                external: false,
                selected: track.isEnabled
            )
        }
    }

    fileprivate var subtitleTracks: [ConduitKSPlayerTrack] {
        guard let player = playerView.playerLayer?.player else { return [] }
        let embedded = player.tracks(mediaType: .subtitle).enumerated().map { index, track in
            ConduitKSPlayerTrack(
                id: Int(track.trackID),
                title: track.name.isEmpty ? "Subtitle \(index + 1)" : track.name,
                language: track.languageCode ?? "",
                codec: String(describing: track),
                channels: "",
                channelCount: 0,
                sampleRate: 0,
                bitrate: track.bitRate,
                external: false,
                selected: playerView.srtControl.selectedSubtitleInfo?.subtitleID == String(track.trackID)
            )
        }
        let embeddedIDs = Set(embedded.map { String($0.id) })
        let external = playerView.srtControl.subtitleInfos.filter {
            !embeddedIDs.contains($0.subtitleID)
        }.enumerated().map { index, info in
            let id = externalSubtitleId(index)
            return ConduitKSPlayerTrack(
                id: id,
                title: info.name,
                language: externalSubtitleLanguages[info.subtitleID] ?? "",
                codec: "",
                channels: "",
                channelCount: 0,
                sampleRate: 0,
                bitrate: 0,
                external: true,
                selected: playerView.srtControl.selectedSubtitleInfo?.subtitleID == info.subtitleID
            )
        }
        return embedded + external
    }

    fileprivate var isPlayerLoading = true
    fileprivate var isPlayerBuffering = false
    fileprivate var isPlayerPlaying = false
    fileprivate var isPlayerEnded = false
    fileprivate var durationMs: Int64 = 0
    fileprivate var positionMs: Int64 = 0
    fileprivate var videoWidth = 0
    fileprivate var videoHeight = 0
    fileprivate var currentSpeed: Float = 1.0
    fileprivate var currentErrorMessage = ""

    override func loadView() {
        view = playerView
    }

    fileprivate func loadFile(
        _ urlString: String,
        initialPositionMs: Int64,
        headers: [String: String],
        subtitles: [ConduitKSSubtitlePayload]
    ) {
        guard let url = URL(string: urlString) else {
            currentErrorMessage = "The media URL is invalid."
            return
        }
        currentErrorMessage = ""
        externalSubtitleLanguages = [:]
        userSelectedSubtitle = false
        didApplyPreferredTracks = false
        let subtitleInfos = subtitles.compactMap { subtitle -> URLSubtitleInfo? in
            guard let subtitleURL = URL(string: subtitle.url) else { return nil }
            let rawID = subtitle.id?.isEmpty == false ? subtitle.id! : subtitle.url
            let id = "external:\(rawID)"
            let name = subtitle.addonName?.isEmpty == false
                ? subtitle.addonName!
                : (subtitle.lang?.isEmpty == false ? subtitle.lang! : subtitleURL.lastPathComponent)
            externalSubtitleLanguages[id] = subtitle.lang ?? ""
            return URLSubtitleInfo(subtitleID: id, name: name, url: subtitleURL)
        }
        let subtitleSource = URLSubtitleDataSouce(urls: [])
        subtitleSource.infos = subtitleInfos

        let options = KSOptions()
        options.startPlayTime = TimeInterval(max(0, initialPositionMs)) / 1000.0
        options.autoSelectEmbedSubtitle = false
        options.canStartPictureInPictureAutomaticallyFromInline = true
        options.appendHeader(headers)

        playerView.playerLayer?.player.shutdown()
        playerView.playerLayer = nil
        let layer = KSPlayerLayer(url: url, isAutoPlay: false, options: options)
        playerView.playerLayer = layer
        playerView.srtControl.url = url
        playerView.set(
            resource: KSPlayerResource(
                name: url.lastPathComponent,
                definitions: [KSPlayerResourceDefinition(url: url, definition: "", options: options)],
                subtitleDataSouce: subtitleSource
            ),
            isSetUrl: false
        )
        layer.player.allowsExternalPlayback = true
        layer.player.usesExternalPlaybackWhileExternalScreenIsActive = true
        if initialPositionMs > 0 {
            layer.seek(time: TimeInterval(initialPositionMs) / 1000.0, autoPlay: true) { _ in }
        }
        refreshPlaybackState()
    }

    func playPlayback() {
        playerView.playerLayer?.play()
        refreshPlaybackState()
    }

    func pausePlayback() {
        playerView.playerLayer?.pause()
        refreshPlaybackState()
    }

    func seekToMs(_ positionMs: Int64) {
        playerView.playerLayer?.seek(time: TimeInterval(max(0, positionMs)) / 1000.0, autoPlay: true) { _ in }
    }

    func seekByMs(_ offsetMs: Int64) {
        let position = Int64((playerView.playerLayer?.player.currentPlaybackTime ?? 0) * 1000)
        seekToMs(position + offsetMs)
    }

    func setSpeed(_ speed: Float) {
        currentSpeed = speed
        playerView.playerLayer?.player.playbackRate = speed
    }

    func setMuted(_ muted: Bool) {
        playerView.playerLayer?.player.isMuted = muted
    }

    func setPreferredAudioLanguage(_ language: String) {
        preferredAudioLanguage = language
        applyPreferredTracks()
    }

    func setPreferredSubtitleLanguage(_ language: String) {
        preferredSubtitleLanguage = language
        userSelectedSubtitle = false
        didApplyPreferredTracks = false
        applyPreferredTracks()
    }

    func setResize(_ mode: Int) {
        guard let player = playerView.playerLayer?.player else { return }
        player.contentMode = mode == 0 ? .scaleAspectFit : .scaleAspectFill
        player.view?.transform = mode == 2
            ? CGAffineTransform(scaleX: 1.109, y: 1.109)
            : .identity
    }

    func retryPlayback() {
        guard let layer = playerView.playerLayer else { return }
        if layer.state == .error {
            currentErrorMessage = ""
            layer.play()
        }
    }

    var isPictureInPictureSupported: Bool {
        if #available(iOS 15.0, *) {
            return playerView.playerLayer?.player.pipController != nil
        }
        return false
    }

    var isPictureInPictureActive: Bool {
        playerView.playerLayer?.isPipActive ?? false
    }

    func startPictureInPicture() {
        guard isPictureInPictureSupported else { return }
        playerView.playerLayer?.isPipActive = true
    }

    func stopPictureInPicture() {
        playerView.playerLayer?.isPipActive = false
    }

    func syncVideoSurfaceLayout(_ size: CGSize) {
        guard size.width > 1, size.height > 1 else { return }
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    func setInteractiveResize(_ active: Bool) {
        // Compose owns the container geometry. KSPlayer's view follows the
        // constraints installed by VideoPlayerView while it is resized.
    }

    func selectAudio(_ trackId: Int) {
        guard let track = playerView.playerLayer?.player.tracks(mediaType: .audio).first(where: { Int($0.trackID) == trackId }) else { return }
        playerView.playerLayer?.player.select(track: track)
    }

    func selectSubtitle(_ trackId: Int) {
        guard let layer = playerView.playerLayer else { return }
        userSelectedSubtitle = true
        if trackId == -1 {
            layer.player.tracks(mediaType: .subtitle).forEach { $0.isEnabled = false }
            playerView.srtControl.selectedSubtitleInfo = nil
            return
        }
        let embeddedTracks = layer.player.tracks(mediaType: .subtitle)
        if let track = embeddedTracks.first(where: { Int($0.trackID) == trackId }) {
            layer.player.select(track: track)
            if let subtitle = track as? any SubtitleInfo {
                playerView.srtControl.selectedSubtitleInfo = subtitle
            }
            return
        }
        let externalInfos = playerView.srtControl.subtitleInfos.filter { info in
            !embeddedTracks.contains { String($0.trackID) == info.subtitleID }
        }
        let externalIndex = -trackId - 1000
        guard externalIndex >= 0, externalIndex < externalInfos.count else { return }
        embeddedTracks.forEach { $0.isEnabled = false }
        playerView.srtControl.selectedSubtitleInfo = externalInfos[externalIndex]
    }

    func refreshPlaybackState() {
        guard let layer = playerView.playerLayer else {
            isPlayerLoading = true
            return
        }
        let player = layer.player
        isPlayerLoading = [.initialized, .preparing].contains(layer.state)
        isPlayerBuffering = layer.state == .buffering
        isPlayerPlaying = layer.state.isPlaying
        isPlayerEnded = layer.state == .playedToTheEnd
        durationMs = Int64(max(0, player.duration) * 1000)
        positionMs = Int64(max(0, player.currentPlaybackTime) * 1000)
        videoWidth = Int(max(0, player.naturalSize.width))
        videoHeight = Int(max(0, player.naturalSize.height))
        currentSpeed = player.playbackRate
        if layer.state == .readyToPlay && !userSelectedSubtitle && !didApplyPreferredTracks {
            applyPreferredTracks()
        }
        if layer.state == .error, currentErrorMessage.isEmpty {
            currentErrorMessage = "KSPlayer failed to play this media."
        }
    }

    func destroyPlayer() {
        stopPictureInPicture()
        playerView.playerLayer?.player.shutdown()
        playerView.playerLayer = nil
        playerView.srtControl.selectedSubtitleInfo = nil
        userSelectedSubtitle = false
        didApplyPreferredTracks = false
    }

    private func externalSubtitleId(_ index: Int) -> Int {
        -1000 - index
    }

    private func applyPreferredTracks() {
        guard let layer = playerView.playerLayer else { return }
        if let preferred = languageCode(preferredAudioLanguage),
           let track = layer.player.tracks(mediaType: .audio).first(where: {
               languageCode($0.languageCode ?? "") == preferred || languageCode($0.name) == preferred
           })
        {
            layer.player.select(track: track)
        }

        guard let preferred = languageCode(preferredSubtitleLanguage) else {
            didApplyPreferredTracks = true
            return
        }
        let embedded = layer.player.tracks(mediaType: .subtitle)
        if let track = embedded.first(where: {
            languageCode($0.languageCode ?? "") == preferred || languageCode($0.name) == preferred
        }) {
            layer.player.select(track: track)
            if let subtitle = track as? any SubtitleInfo {
                playerView.srtControl.selectedSubtitleInfo = subtitle
            }
            didApplyPreferredTracks = true
            return
        }
        let external = playerView.srtControl.subtitleInfos.first {
            languageCode(externalSubtitleLanguages[$0.subtitleID] ?? "") == preferred
        }
        if let external {
            embedded.forEach { $0.isEnabled = false }
            playerView.srtControl.selectedSubtitleInfo = external
            // KSPlayer adds embedded tracks about one second after ready. Do
            // not finalize the preference until that late track discovery has
            // happened, otherwise an external match can mask the embedded
            // track we would normally prefer.
            didApplyPreferredTracks = !embedded.isEmpty
        } else if !embedded.isEmpty {
            // The embedded tracks are added asynchronously by KSPlayer. Keep
            // polling when they have not appeared yet, but stop retrying once
            // the available embedded subtitle set has been inspected.
            didApplyPreferredTracks = true
        }
    }

    private func languageCode(_ value: String) -> String? {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        let base = normalized.split(separator: "-").first.map(String.init) ?? normalized
        let aliases = [
            "english": "en", "eng": "en", "spanish": "es", "spa": "es",
            "french": "fr", "fra": "fr", "fre": "fr", "german": "de", "deu": "de", "ger": "de",
            "italian": "it", "ita": "it", "portuguese": "pt", "por": "pt", "japanese": "ja", "jpn": "ja",
            "korean": "ko", "kor": "ko", "chinese": "zh", "zho": "zh", "chi": "zh",
            "arabic": "ar", "ara": "ar", "indonesian": "id", "ind": "id", "russian": "ru", "rus": "ru",
            "hindi": "hi", "hin": "hi",
        ]
        if base == "system" || base == "default" || base.isEmpty { return nil }
        return aliases[base] ?? (base.count == 2 ? base : nil)
    }
}
