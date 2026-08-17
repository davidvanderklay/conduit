import AVFoundation
@preconcurrency import AVKit
import ComposeApp
import CoreImage
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
        guard let code = playerViewController?.languageCode(language) else { return "" }
        return Locale(identifier: "en_US").localizedString(forLanguageCode: code)?.localizedCapitalized ?? ""
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

    override func layoutSubviews() {
        super.layoutSubviews()
        applyConduitSubtitleFont()
    }

    override func player(layer: KSPlayerLayer, currentTime: TimeInterval, totalTime: TimeInterval) {
        super.player(layer: layer, currentTime: currentTime, totalTime: totalTime)
        applyConduitSubtitleFont()
    }

    private func applyConduitSubtitleFont() {
        guard bounds.height > 1 else { return }
        let size = bounds.height < 300
            ? max(12, min(16, bounds.height * 0.1))
            : 24
        let font = SubtitleModel.textFont.withSize(size)
        subtitleLabel.font = font
        guard let attributedText = subtitleLabel.attributedText, attributedText.length > 0 else { return }

        let range = NSRange(location: 0, length: attributedText.length)
        var needsNormalization = false
        attributedText.enumerateAttributes(in: range) { attributes, _, stop in
            guard !needsNormalization else {
                stop.pointee = true
                return
            }
            let hasExpectedFont = (attributes[.font] as? UIFont).map {
                abs($0.pointSize - size) < 0.1
            } ?? false
            needsNormalization = !hasExpectedFont ||
                attributes[.expansion] != nil ||
                attributes[.obliqueness] != nil
        }
        guard needsNormalization else {
            return
        }

        // KSPlayer preserves ASS expansion/obliqueness attributes. Its ASS
        // parser currently uses those attributes for bold/italic tags, but
        // UIKit interprets them as geometric stretching and shearing. The
        // app uses one consistent subtitle style, so discard those source
        // transforms while retaining the text itself.
        let normalized = NSMutableAttributedString(attributedString: attributedText)
        normalized.removeAttribute(.expansion, range: range)
        normalized.removeAttribute(.obliqueness, range: range)
        normalized.addAttribute(
            .font,
            value: font,
            range: range
        )
        subtitleLabel.attributedText = normalized
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
    private lazy var pipSubtitleCoordinator = ConduitKSPictureInPictureCoordinator(playerView: playerView)
    private var preferredAudioLanguage = "System default"
    private var preferredSubtitleLanguage = "English"
    private var externalSubtitleLanguages: [String: String] = [:]
    private var userSelectedAudio = false
    private var userSelectedSubtitle = false
    private var didApplyPreferredAudio = false
    private var didApplyPreferredTracks = false
    private var shouldPlay = false

    fileprivate var audioTracks: [ConduitKSPlayerTrack] {
        guard let player = playerView.playerLayer?.player else { return [] }
        return player.tracks(mediaType: .audio).enumerated().map { index, track in
            let asbd = track.audioStreamBasicDescription
            let language = track.languageCode ?? ""
            return ConduitKSPlayerTrack(
                id: Int(track.trackID),
                title: displayTrackTitle(track.name, language: language, fallback: "Audio \(index + 1)"),
                language: language,
                codec: mediaCodecName(track) ?? "",
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
            let language = track.languageCode ?? ""
            ConduitKSPlayerTrack(
                id: Int(track.trackID),
                title: displayTrackTitle(track.name, language: language, fallback: "Subtitle \(index + 1)"),
                language: language,
                codec: mediaCodecName(track) ?? "",
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
        userSelectedAudio = false
        userSelectedSubtitle = false
        didApplyPreferredAudio = false
        didApplyPreferredTracks = false
        stopPictureInPicture()
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
        // Keep KSPlayer from selecting the first embedded text stream. Text
        // streams are commonly all reported as enabled, so that default is
        // not a language preference. The bridge selects subtitles below.
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
        shouldPlay = true
        playerView.playerLayer?.play()
        refreshPlaybackState()
    }

    func pausePlayback() {
        shouldPlay = false
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
        userSelectedAudio = false
        didApplyPreferredAudio = false
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
            shouldPlay = true
            currentErrorMessage = ""
            layer.play()
        }
    }

    var isPictureInPictureSupported: Bool {
        pipSubtitleCoordinator.isSupported || nativePictureInPictureController != nil
    }

    var isPictureInPictureActive: Bool {
        pipSubtitleCoordinator.isActive || playerView.playerLayer?.isPipActive == true
    }

    func startPictureInPicture() {
        guard isPictureInPictureSupported else { return }
        if pipSubtitleCoordinator.start() {
            return
        }
        playerView.playerLayer?.isPipActive = true
    }

    func stopPictureInPicture() {
        pipSubtitleCoordinator.stop()
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
        userSelectedAudio = true
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
        if shouldPlay && layer.state == .readyToPlay {
            // The initial play command can arrive while KSPlayer is still
            // preparing. Re-issue it once the layer has a usable timeline.
            layer.play()
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
        if layer.state == .readyToPlay {
            applyPreferredTracks()
        }
        if layer.state == .error, currentErrorMessage.isEmpty {
            currentErrorMessage = "KSPlayer failed to play this media."
        }
    }

    func destroyPlayer() {
        stopPictureInPicture()
        shouldPlay = false
        playerView.playerLayer?.player.shutdown()
        playerView.playerLayer = nil
        playerView.srtControl.selectedSubtitleInfo = nil
        userSelectedAudio = false
        userSelectedSubtitle = false
        didApplyPreferredAudio = false
        didApplyPreferredTracks = false
    }

    private func externalSubtitleId(_ index: Int) -> Int {
        -1000 - index
    }

    private func applyPreferredTracks() {
        guard let layer = playerView.playerLayer else { return }
        applyPreferredAudioTrack(layer: layer)
        guard !userSelectedSubtitle, !didApplyPreferredTracks else { return }

        let embedded = layer.player.tracks(mediaType: .subtitle)
        let preferred = preferredLanguageCode(preferredSubtitleLanguage)
        if let track = preferred.flatMap({ preferred in
            embedded.first(where: {
                languageCode($0.languageCode ?? "") == preferred
            }) ?? embedded.first(where: {
                languageCode($0.name) == preferred
            })
        }) {
            layer.player.select(track: track)
            if let subtitle = track as? any SubtitleInfo {
                playerView.srtControl.selectedSubtitleInfo = subtitle
            }
            didApplyPreferredTracks = true
            return
        }
        let external = preferred.flatMap { preferred in
            playerView.srtControl.subtitleInfos.first {
                languageCode(externalSubtitleLanguages[$0.subtitleID] ?? "") == preferred
            }
        }
        if let external {
            embedded.forEach { $0.isEnabled = false }
            playerView.srtControl.selectedSubtitleInfo = external
            // KSPlayer adds embedded tracks about one second after ready. Do
            // not finalize the preference until that late track discovery has
            // happened, otherwise an external match can mask the embedded
            // track we would normally prefer.
            didApplyPreferredTracks = !embedded.isEmpty
        } else if let track = embedded.first {
            // Keep subtitles on even when the preferred language is not
            // present. Embedded subtitles are the best fallback.
            layer.player.select(track: track)
            if let subtitle = track as? any SubtitleInfo {
                playerView.srtControl.selectedSubtitleInfo = subtitle
            }
            didApplyPreferredTracks = true
        } else if let external = playerView.srtControl.subtitleInfos.first {
            // External subtitles can be available before KSPlayer exposes
            // embedded tracks. Keep retrying so a later preferred embedded
            // track can still take precedence.
            playerView.srtControl.selectedSubtitleInfo = external
            didApplyPreferredTracks = false
        }
    }

    private func applyPreferredAudioTrack(layer: KSPlayerLayer) {
        guard !userSelectedAudio, !didApplyPreferredAudio else { return }
        guard let preferred = preferredLanguageCode(preferredAudioLanguage) else {
            didApplyPreferredAudio = true
            return
        }
        let tracks = layer.player.tracks(mediaType: .audio)
        let track = tracks.first(where: {
            languageCode($0.languageCode ?? "") == preferred
        }) ?? tracks.first(where: {
            languageCode($0.name) == preferred
        })
        guard let track else { return }
        layer.player.select(track: track)
        didApplyPreferredAudio = true
    }

    fileprivate func languageCode(_ value: String) -> String? {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        let base = normalized
            .components(separatedBy: CharacterSet(charactersIn: "-_:([·, "))
            .first(where: { !$0.isEmpty }) ?? normalized
        let aliases = [
            "english": "en", "eng": "en", "spanish": "es", "spa": "es",
            "french": "fr", "fra": "fr", "fre": "fr", "german": "de", "deu": "de", "ger": "de",
            "italian": "it", "ita": "it", "portuguese": "pt", "por": "pt", "japanese": "ja", "jpn": "ja",
            "korean": "ko", "kor": "ko", "chinese": "zh", "zho": "zh", "chi": "zh",
            "arabic": "ar", "ara": "ar", "indonesian": "id", "ind": "id", "russian": "ru", "rus": "ru",
            "hindi": "hi", "hin": "hi", "tamil": "ta", "tam": "ta", "telugu": "te", "tel": "te",
            "kannada": "kn", "kan": "kn", "malayalam": "ml", "mal": "ml", "marathi": "mr", "mar": "mr",
            "punjabi": "pa", "pan": "pa", "bengali": "bn", "ben": "bn",
        ]
        if base == "system" || base == "default" || base.isEmpty { return nil }
        return aliases[base] ?? (base.count == 2 ? base : nil)
    }

    private func preferredLanguageCode(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "system default" || normalized == "system" || normalized == "default" {
            return languageCode(Locale.current.languageCode ?? "")
        }
        return languageCode(value)
    }

    private func localizedLanguageName(_ language: String) -> String? {
        guard let code = languageCode(language) else { return nil }
        return Locale(identifier: "en_US").localizedString(forLanguageCode: code)?.localizedCapitalized
    }

    private func mediaCodecName(_ track: any MediaPlayerTrack) -> String? {
        (track as? FFmpegAssetTrack)?.codecName
    }

    private func displayTrackTitle(_ title: String, language: String, fallback: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty || isSourceLabel(trimmed) else { return trimmed }
        return localizedLanguageName(language) ?? fallback
    }

    private func isSourceLabel(_ value: String) -> Bool {
        let normalized = value.lowercased()
        if normalized.hasPrefix("http://") || normalized.hasPrefix("https://") || normalized.hasPrefix("www.") {
            return true
        }
        guard !normalized.contains(where: { $0.isWhitespace }), normalized.contains(".") else { return false }
        return URL(string: "https://\(normalized)")?.host?.contains(".") == true
    }

    private var nativePictureInPictureController: KSPictureInPictureController? {
        if #available(iOS 15.0, *) {
            return playerView.playerLayer?.player.pipController
        }
        return nil
    }
}

/// KSPlayer's subtitle view is a UIKit overlay, but PiP only accepts a player
/// layer or sample-buffer display layer. Mirror the current video frame into a
/// PiP-owned sample-buffer layer and composite the active KS subtitle into
/// that frame before enqueueing it.
@MainActor
final class ConduitKSPictureInPictureCoordinator: NSObject,
    @preconcurrency AVPictureInPictureControllerDelegate,
    @preconcurrency AVPictureInPictureSampleBufferPlaybackDelegate {
    private weak var playerView: ConduitKSPlayerView?
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var controller: AVPictureInPictureController?
    private var displayLink: CADisplayLink?
    private var videoOutput: AVPlayerItemVideoOutput?
    private weak var attachedItem: AVPlayerItem?
    private var pixelBufferPool: CVPixelBufferPool?
    private var formatDescription: CMVideoFormatDescription?
    private var ciContext = CIContext(options: [.cacheIntermediates: false])
    private var lastSourceBuffer: CVPixelBuffer?
    private var pixelBufferSize = CGSize.zero
    private var lastSubtitleKey = ""
    private var subtitleOverlay: CIImage?
    private var isPriming = false
    private var renderedFrameCount = 0
    private var pictureInPicturePossibleObservation: NSKeyValueObservation?
    private var primingTimeoutWorkItem: DispatchWorkItem?

    init(playerView: ConduitKSPlayerView) {
        self.playerView = playerView
        super.init()

        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = UIColor.black.cgColor
        playerView.layer.insertSublayer(displayLayer, at: 0)
        var timebase: CMTimebase?
        CMTimebaseCreateWithSourceClock(
            allocator: kCFAllocatorDefault,
            sourceClock: CMClockGetHostTimeClock(),
            timebaseOut: &timebase
        )
        if let timebase {
            displayLayer.controlTimebase = timebase
            CMTimebaseSetTime(timebase, time: .zero)
            CMTimebaseSetRate(timebase, rate: 1)
        }

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
            DispatchQueue.main.async { [weak self] in
                self?.attemptStart()
            }
        }
    }

    var isSupported: Bool {
        AVPictureInPictureController.isPictureInPictureSupported()
    }

    var isActive: Bool {
        controller?.isPictureInPictureActive == true || isPriming
    }

    func start() -> Bool {
        guard isSupported, !isActive, playerView?.playerLayer?.player != nil else { return false }
        guard prepareVideoOutput() else { return false }

        isPriming = true
        renderedFrameCount = 0
        lastSourceBuffer = nil
        displayLayer.frame = playerView?.bounds ?? .zero
        displayLayer.flush()
        displayLink?.invalidate()
        let displayLink = CADisplayLink(target: self, selector: #selector(renderFrame))
        displayLink.add(to: .main, forMode: .common)
        self.displayLink = displayLink
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.isPriming else { return }
            self.cleanup()
        }
        primingTimeoutWorkItem = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
        renderFrame()
        attemptStart()
        return true
    }

    func stop() {
        let wasActive = isActive
        cleanup()
        if wasActive {
            controller?.stopPictureInPicture()
        }
    }

    private func cleanup() {
        isPriming = false
        displayLink?.invalidate()
        displayLink = nil
        primingTimeoutWorkItem?.cancel()
        primingTimeoutWorkItem = nil
        videoOutput.flatMap { output in
            attachedItem?.remove(output)
        }
        attachedItem = nil
        videoOutput = nil
        lastSourceBuffer = nil
        subtitleOverlay = nil
        lastSubtitleKey = ""
        pixelBufferPool = nil
        pixelBufferSize = .zero
        formatDescription = nil
        displayLayer.flushAndRemoveImage()
    }

    private func prepareVideoOutput() -> Bool {
        guard let player = playerView?.playerLayer?.player else { return false }
        if let player = player as? KSMEPlayer {
            player.videoOutput?.readNextFrame()
            return player.videoOutput != nil
        }
        guard let player = player as? KSAVPlayer,
              let playerView = player.view as? KSAVPlayerView,
              let item = playerView.player.currentItem
        else { return false }
        if videoOutput == nil {
            videoOutput = AVPlayerItemVideoOutput(pixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            ])
        }
        if attachedItem !== item {
            attachedItem?.remove(videoOutput!)
            item.add(videoOutput!)
            attachedItem = item
        }
        return true
    }

    @objc private func renderFrame() {
        guard isPriming || controller?.isPictureInPictureActive == true else { return }
        guard let frame = currentVideoFrame() else { return }
        guard frame.buffer !== lastSourceBuffer || (isPriming && renderedFrameCount < 2) else { return }
        lastSourceBuffer = frame.buffer
        guard let outputBuffer = compositedBuffer(
            source: frame.buffer,
            subtitle: currentSubtitleOverlay(for: frame.buffer, at: frame.time.seconds)
        ) else { return }
        enqueue(outputBuffer, at: frame.time)
        renderedFrameCount += 1
        if isPriming, renderedFrameCount >= 2 {
            attemptStart()
        }
    }

    private func currentVideoFrame() -> (buffer: CVPixelBuffer, time: CMTime)? {
        guard let player = playerView?.playerLayer?.player else { return nil }
        if let player = player as? KSMEPlayer {
            player.videoOutput?.readNextFrame()
        }
        if let player = player as? KSMEPlayer,
           let buffer = player.videoOutput?.pixelBuffer?.cvPixelBuffer {
            let seconds = max(0, player.displayedVideoTime)
            return (buffer, CMTime(seconds: seconds, preferredTimescale: 1_000))
        }
        guard let player = player as? KSAVPlayer,
              let playerView = player.view as? KSAVPlayerView,
              playerView.player.currentItem != nil,
              let videoOutput
        else { return nil }
        let itemTime = playerView.player.currentTime()
        guard videoOutput.hasNewPixelBuffer(forItemTime: itemTime),
              let buffer = videoOutput.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil)
        else { return nil }
        return (buffer, itemTime)
    }

    private func currentSubtitleOverlay(for sourceBuffer: CVPixelBuffer, at time: TimeInterval) -> CIImage? {
        guard let playerView, playerView.playerLayer != nil else { return nil }
        _ = playerView.srtControl.subtitle(currentTime: max(0, time))
        guard let part = playerView.srtControl.parts.first else {
            lastSubtitleKey = ""
            subtitleOverlay = nil
            return nil
        }
        let text = part.text?.string ?? ""
        let key = "\(part.start):\(part.end):\(text)"
        guard key != lastSubtitleKey else { return subtitleOverlay }
        lastSubtitleKey = key
        let width = CVPixelBufferGetWidth(sourceBuffer)
        let height = CVPixelBufferGetHeight(sourceBuffer)
        guard width > 1, height > 1 else { return nil }
        if let image = part.image?.cgImage {
            subtitleOverlay = CIImage(cgImage: image).transformed(
                by: CGAffineTransform(
                    scaleX: CGFloat(width) * 0.8 / CGFloat(image.width),
                    y: CGFloat(height) * 0.25 / CGFloat(image.height)
                ).translatedBy(x: CGFloat(width) * 0.1, y: CGFloat(height) * 0.08)
            )
            return subtitleOverlay
        }
        guard !text.isEmpty else {
            subtitleOverlay = nil
            return nil
        }
        subtitleOverlay = makeTextOverlay(text, width: width, height: height)
        return subtitleOverlay
    }

    private func makeTextOverlay(_ text: String, width: Int, height: Int) -> CIImage? {
        // The composited frame is later reduced to the PiP window. A normal
        // 24px subtitle therefore becomes unreadably small in PiP.
        let size = CGFloat(max(24, min(96, Double(height) * 0.09)))
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
        let image = renderer.image { _ in
            let rect = CGRect(
                x: CGFloat(width) * 0.05,
                y: CGFloat(height) * 0.68,
                width: CGFloat(width) * 0.9,
                height: CGFloat(height) * 0.25
            )
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: size),
                .foregroundColor: UIColor.white,
                .strokeColor: UIColor.black,
                .strokeWidth: -3,
                .paragraphStyle: {
                    let style = NSMutableParagraphStyle()
                    style.alignment = .center
                    style.lineBreakMode = .byWordWrapping
                    return style
                }(),
            ]
            (text as NSString).draw(in: rect, withAttributes: attributes)
        }
        return image.cgImage.map(CIImage.init)
    }

    private func compositedBuffer(source: CVPixelBuffer, subtitle: CIImage?) -> CVPixelBuffer? {
        let width = CVPixelBufferGetWidth(source)
        let height = CVPixelBufferGetHeight(source)
        if pixelBufferPool == nil || formatDescription == nil ||
            pixelBufferSize != CGSize(width: width, height: height) {
            let attributes: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
            CVPixelBufferPoolCreate(
                kCFAllocatorDefault,
                nil,
                attributes as CFDictionary,
                &pixelBufferPool
            )
            pixelBufferSize = CGSize(width: width, height: height)
            formatDescription = nil
        }
        guard let pixelBufferPool else { return nil }
        var output: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pixelBufferPool, &output) == kCVReturnSuccess,
              let output
        else { return nil }

        let video = CIImage(cvPixelBuffer: source)
        let image = subtitle?.composited(over: video) ?? video
        ciContext.render(image, to: output)
        if formatDescription == nil {
            CMVideoFormatDescriptionCreateForImageBuffer(
                allocator: kCFAllocatorDefault,
                imageBuffer: output,
                formatDescriptionOut: &formatDescription
            )
        }
        return output
    }

    private func enqueue(_ buffer: CVPixelBuffer, at time: CMTime) {
        guard let formatDescription else { return }
        var sampleBuffer: CMSampleBuffer?
        let timing = CMSampleTimingInfo(
            duration: .invalid,
            presentationTimeStamp: time,
            decodeTimeStamp: .invalid
        )
        CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: buffer,
            formatDescription: formatDescription,
            sampleTiming: [timing],
            sampleBufferOut: &sampleBuffer
        )
        guard let sampleBuffer else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true) as? [NSMutableDictionary],
           let attachment = attachments.first {
            attachment[kCMSampleAttachmentKey_DisplayImmediately] = true
        }
        guard displayLayer.isReadyForMoreMediaData else { return }
        displayLayer.enqueue(sampleBuffer)
    }

    private func attemptStart() {
        guard isPriming, renderedFrameCount >= 2,
              let controller, !controller.isPictureInPictureActive,
              controller.isPictureInPicturePossible
        else { return }
        primingTimeoutWorkItem?.cancel()
        primingTimeoutWorkItem = nil
        isPriming = false
        controller.startPictureInPicture()
    }

    func pictureInPictureControllerDidStopPictureInPicture(_: AVPictureInPictureController) {
        cleanup()
    }

    func pictureInPictureController(_: AVPictureInPictureController, failedToStartPictureInPictureWithError _: Error) {
        cleanup()
    }

    func pictureInPictureController(_: AVPictureInPictureController, setPlaying playing: Bool) {
        playing ? playerView?.playerLayer?.play() : playerView?.playerLayer?.pause()
    }

    func pictureInPictureControllerTimeRangeForPlayback(_: AVPictureInPictureController) -> CMTimeRange {
        let duration = playerView?.playerLayer?.player.duration ?? 0
        if duration == 0 {
            return CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
        }
        return CMTimeRange(start: .zero, duration: CMTime(seconds: duration, preferredTimescale: 1_000))
    }

    func pictureInPictureControllerIsPlaybackPaused(_: AVPictureInPictureController) -> Bool {
        playerView?.playerLayer?.player.isPlaying != true
    }

    func pictureInPictureController(_: AVPictureInPictureController, didTransitionToRenderSize _: CMVideoDimensions) {}

    func pictureInPictureController(_: AVPictureInPictureController, skipByInterval skipInterval: CMTime) async {
        guard let playerView else { return }
        await MainActor.run {
            let currentTime = playerView.playerLayer?.player.currentPlaybackTime ?? 0
            playerView.playerLayer?.seek(time: currentTime + skipInterval.seconds, autoPlay: true) { _ in }
        }
    }

    func pictureInPictureControllerShouldProhibitBackgroundAudioPlayback(_: AVPictureInPictureController) -> Bool {
        false
    }

    func pictureInPictureController(
        _: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(true)
    }
}
