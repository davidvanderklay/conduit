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

fileprivate func conduitLanguageCode(_ value: String) -> String? {
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

fileprivate final class ConduitKSOptions: KSOptions {
    private let preferredAudioCode: String?

    init(preferredAudioLanguage: String) {
        let normalized = preferredAudioLanguage.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let language = normalized == "system default" || normalized == "system" || normalized == "default"
            ? Locale.current.languageCode ?? ""
            : preferredAudioLanguage
        preferredAudioCode = conduitLanguageCode(language)
        super.init()
    }

    override func wantedAudio(tracks: [any MediaPlayerTrack]) -> Int? {
        guard let preferredAudioCode else { return nil }
        return tracks.firstIndex { track in
            conduitLanguageCode(track.languageCode ?? "") == preferredAudioCode
                || conduitLanguageCode(track.name) == preferredAudioCode
        }
    }
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
    private struct SubtitleSnapshot {
        let start: TimeInterval
        let end: TimeInterval
        let text: NSAttributedString?
        let image: UIImage?
        let origin: CGPoint
        let textPosition: TextPosition?
        let preservesSourceMetrics: Bool
    }

    private var activeSubtitleSnapshot: SubtitleSnapshot?
    private var cachedSubtitleSnapshots: [String: SubtitleSnapshot] = [:]
    private var cachedSubtitleID: String?
    private var isApplyingSubtitleLayout = false

    override func customizeUIComponents() {
        // Keep ordinary subtitles at the app's established 24pt size. ASS
        // cues are restored from their source attributes below instead of
        // being forced through this global fallback.
        SubtitleModel.textFontSize = 24
        super.customizeUIComponents()
        hideBuiltInControls()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        applyConduitSubtitleFont()
    }

    override func player(layer: KSPlayerLayer, currentTime: TimeInterval, totalTime: TimeInterval) {
        let selectedSubtitleID = srtControl.selectedSubtitleInfo?.subtitleID
        if cachedSubtitleID != selectedSubtitleID {
            cachedSubtitleID = selectedSubtitleID
            cachedSubtitleSnapshots.removeAll()
        }
        // URLSubtitleInfo.search is a regular array lookup, but embedded
        // FFmpegAssetTrack.search consumes KSPlayer's subtitle queue. Never
        // search an embedded track before super.player: VideoPlayerView does
        // the consuming lookup itself and would otherwise see an empty cue.
        let sourceSnapshot = sourceSubtitleSnapshotBeforePlayer(at: currentTime).map { snapshot in
            guard snapshot.textPosition != nil else { return snapshot }
            let key = subtitleSnapshotKey(snapshot)
            if let cached = cachedSubtitleSnapshots[key] {
                return cached
            }
            cachedSubtitleSnapshots[key] = snapshot
            return snapshot
        }
        super.player(layer: layer, currentTime: currentTime, totalTime: totalTime)
        let subtitleTime = srtControl.selectedSubtitleInfo.map {
            max(0, currentTime - $0.delay - srtControl.subtitleDelay)
        }
        let hasEmptyCurrentPart = subtitleTime.map { time in
            guard let part = srtControl.parts.first else { return false }
            let isCurrent = part.start <= time + subtitleVisibilityTolerance &&
                part.end >= time - subtitleVisibilityTolerance
            return !hasRenderableSubtitleContent(part) && isCurrent
        } ?? false
        if hasEmptyCurrentPart {
            // KSPlayer emits empty parts to terminate bitmap cues. Its base
            // view still marks those parts visible, so clear that sentinel
            // instead of letting it become a plain-text renderer state.
            clearSubtitlePresentation()
        } else {
            let presentedSnapshot = sourceSnapshot ?? presentedSubtitleSnapshot(at: currentTime)
            if let presentedSnapshot {
                if presentedSnapshot.textPosition != nil {
                    let key = subtitleSnapshotKey(presentedSnapshot)
                    let snapshot = cachedSubtitleSnapshots[key] ?? presentedSnapshot
                    activeSubtitleSnapshot = snapshot
                    cachedSubtitleSnapshots[key] = snapshot
                } else {
                    activeSubtitleSnapshot = presentedSnapshot
                }
            } else if let activeSubtitleSnapshot, !subtitleBackView.isHidden {
                // Keep the current renderer while the subtitle view is still
                // visible. KSPlayer can briefly publish no matching part while
                // advancing an embedded queue; falling back to ordinary sizing
                // here makes the same ASS cue visibly change size.
                self.activeSubtitleSnapshot = activeSubtitleSnapshot
            } else {
                activeSubtitleSnapshot = nil
            }
        }
        applyConduitSubtitleFont()
    }

    fileprivate func refreshSubtitlePresentation(fallbackPart: SubtitlePart? = nil) {
        guard let part = fallbackPart ?? srtControl.parts.first,
              hasRenderableSubtitleContent(part)
        else {
            clearSubtitlePresentation()
            applyConduitSubtitleFont()
            return
        }
        subtitleBackView.image = part.image
        if let snapshot = activeSubtitleSnapshot, snapshotMatches(snapshot, part: part) {
            subtitleLabel.attributedText = snapshot.text
        } else {
            activeSubtitleSnapshot = nil
            subtitleLabel.attributedText = part.text
        }
        subtitleBackView.isHidden = false
        applyConduitSubtitleFont()
    }

    fileprivate func resetSubtitlePresentationCache() {
        clearSubtitlePresentation()
        cachedSubtitleSnapshots.removeAll()
        cachedSubtitleID = nil
        subtitleBackView.transform = .identity
    }

    private func applyConduitSubtitleFont() {
        guard bounds.height > 1 else { return }
        guard !isApplyingSubtitleLayout else { return }
        isApplyingSubtitleLayout = true
        defer { isApplyingSubtitleLayout = false }

        if let snapshot = activeSubtitleSnapshot,
           snapshot.textPosition != nil,
           let text = snapshot.text {
            let renderedText = scaledASSAttributedText(
                text,
                preservesSourceMetrics: snapshot.preservesSourceMetrics
            )
            if subtitleLabel.attributedText?.isEqual(to: renderedText) != true {
                subtitleLabel.attributedText = renderedText
            }
            subtitleLabel.font = SubtitleModel.textFont.withSize(24)
            applyASSPosition(snapshot.textPosition)
            return
        }

        if let snapshot = activeSubtitleSnapshot, let image = snapshot.image {
            applyBitmapPosition(image: image, origin: snapshot.origin)
            return
        }

        subtitleBackView.transform = .identity
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

        // Plain text subtitles use one consistent app style. ASS subtitles
        // take the source-preserving path above, where KSPlayer's pseudo
        // bold/italic attributes are converted into actual font traits.
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

    private func sourceSubtitleSnapshotBeforePlayer(at time: TimeInterval) -> SubtitleSnapshot? {
        guard let selectedSubtitle = srtControl.selectedSubtitleInfo else { return nil }
        guard !(selectedSubtitle is any MediaPlayerTrack) else { return nil }
        let subtitleTime = max(0, time - selectedSubtitle.delay - srtControl.subtitleDelay)
        guard let part = selectedSubtitle.search(for: subtitleTime).first,
              hasRenderableSubtitleContent(part)
        else { return nil }
        return makeSubtitleSnapshot(
            for: part,
            preservesSourceMetrics: true
        )
    }

    private func presentedSubtitleSnapshot(at time: TimeInterval) -> SubtitleSnapshot? {
        guard let selectedSubtitle = srtControl.selectedSubtitleInfo else { return nil }
        let subtitleTime = max(0, time - selectedSubtitle.delay - srtControl.subtitleDelay)
        guard let part = srtControl.parts.first,
              hasRenderableSubtitleContent(part),
              part.start <= subtitleTime + subtitleVisibilityTolerance,
              part.end >= subtitleTime - subtitleVisibilityTolerance
        else { return nil }
        return makeSubtitleSnapshot(
            for: part,
            preservesSourceMetrics: false
        )
    }

    private func hasRenderableSubtitleContent(_ part: SubtitlePart) -> Bool {
        part.image != nil || (part.text?.length ?? 0) > 0
    }

    private func clearSubtitlePresentation() {
        activeSubtitleSnapshot = nil
        subtitleBackView.image = nil
        subtitleLabel.attributedText = nil
        subtitleBackView.isHidden = true
        subtitleBackView.transform = .identity
    }

    private func makeSubtitleSnapshot(
        for part: SubtitlePart,
        preservesSourceMetrics: Bool
    ) -> SubtitleSnapshot {
        SubtitleSnapshot(
            start: part.start,
            end: part.end,
            text: part.text.map { NSAttributedString(attributedString: $0) },
            image: part.image,
            origin: part.origin,
            textPosition: part.textPosition,
            preservesSourceMetrics: preservesSourceMetrics
        )
    }

    private func snapshotMatches(_ snapshot: SubtitleSnapshot, part: SubtitlePart) -> Bool {
        snapshot.start == part.start && snapshot.end == part.end
    }

    private let subtitleVisibilityTolerance: TimeInterval = 0.25

    private func subtitleSnapshotKey(_ snapshot: SubtitleSnapshot) -> String {
        "\(snapshot.start):\(snapshot.end)"
    }

    private func scaledASSAttributedText(
        _ source: NSAttributedString,
        preservesSourceMetrics: Bool
    ) -> NSAttributedString {
        let scale = preservesSourceMetrics ? subtitleViewportScale() : 1
        let result = NSMutableAttributedString(attributedString: source)
        let fullRange = NSRange(location: 0, length: source.length)

        source.enumerateAttributes(in: fullRange) { attributes, range, _ in
            let sourceFont = (attributes[.font] as? UIFont) ?? SubtitleModel.textFont
            var traits = sourceFont.fontDescriptor.symbolicTraits
            if (attributes[.expansion] as? NSNumber)?.doubleValue != 0 {
                traits.insert(.traitBold)
            }
            if (attributes[.obliqueness] as? NSNumber)?.doubleValue != 0 {
                traits.insert(.traitItalic)
            }

            let descriptor = sourceFont.fontDescriptor.withSymbolicTraits(traits) ?? sourceFont.fontDescriptor
            let fontSize = max(1, sourceFont.pointSize * scale)
            let font = UIFont(descriptor: descriptor, size: fontSize) ?? sourceFont.withSize(fontSize)
            result.addAttribute(.font, value: font, range: range)
            result.removeAttribute(.expansion, range: range)
            result.removeAttribute(.obliqueness, range: range)

            if let strokeWidth = (attributes[.strokeWidth] as? NSNumber)?.doubleValue {
                result.addAttribute(.strokeWidth, value: strokeWidth * scale, range: range)
            }

            if let sourceShadow = attributes[.shadow] as? NSShadow,
               let shadow = sourceShadow.copy() as? NSShadow {
                shadow.shadowOffset = CGSize(
                    width: shadow.shadowOffset.width * scale,
                    height: shadow.shadowOffset.height * scale
                )
                shadow.shadowBlurRadius *= scale
                result.addAttribute(.shadow, value: shadow, range: range)
            }
        }
        return result
    }

    private func subtitleViewportScale() -> CGFloat {
        guard let player = playerLayer?.player else { return 1 }
        let source = player.naturalSize
        guard source.width > 1, source.height > 1, bounds.width > 1, bounds.height > 1 else { return 1 }
        switch player.contentMode {
        case .scaleAspectFill:
            return max(bounds.width / source.width, bounds.height / source.height)
        case .scaleToFill:
            return min(bounds.width / source.width, bounds.height / source.height)
        default:
            return min(bounds.width / source.width, bounds.height / source.height)
        }
    }

    private func videoContentRect() -> CGRect {
        guard let player = playerLayer?.player,
              player.naturalSize.width > 1,
              player.naturalSize.height > 1
        else { return bounds }

        let source = player.naturalSize
        let scale = subtitleViewportScale()
        let size = CGSize(width: source.width * scale, height: source.height * scale)
        return CGRect(
            x: bounds.midX - size.width / 2,
            y: bounds.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
    }

    private func applyBitmapPosition(image: UIImage, origin: CGPoint) {
        guard subtitleBackView.isHidden == false else {
            subtitleBackView.transform = .identity
            return
        }

        subtitleBackView.transform = .identity
        layoutIfNeeded()
        let frame = subtitleBackView.frame
        guard frame.width > 0, frame.height > 0 else { return }

        let scale = subtitleViewportScale()
        let desiredSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let imageScaleX = desiredSize.width / frame.width
        let imageScaleY = desiredSize.height / frame.height
        guard imageScaleX.isFinite, imageScaleY.isFinite, imageScaleX > 0, imageScaleY > 0 else { return }

        let contentRect = videoContentRect()
        let targetCenter: CGPoint
        if origin == .zero {
            targetCenter = CGPoint(
                x: contentRect.midX,
                y: contentRect.maxY - desiredSize.height / 2 - 5
            )
        } else {
            targetCenter = CGPoint(
                x: contentRect.minX + origin.x * scale + desiredSize.width / 2,
                y: contentRect.minY + origin.y * scale + desiredSize.height / 2
            )
        }

        subtitleBackView.transform = CGAffineTransform(
            translationX: targetCenter.x - frame.midX,
            y: targetCenter.y - frame.midY
        ).scaledBy(x: imageScaleX, y: imageScaleY)
    }

    private func applyASSPosition(_ position: TextPosition?) {
        guard let position, subtitleBackView.isHidden == false else {
            subtitleBackView.transform = .identity
            return
        }

        subtitleBackView.transform = .identity
        layoutIfNeeded()
        let frame = subtitleBackView.frame
        guard frame.width > 0, frame.height > 0 else { return }

        let scale = subtitleViewportScale()
        let horizontalMargin: CGFloat
        if position.horizontalAlign == .leading {
            horizontalMargin = position.leftMargin * scale
        } else if position.horizontalAlign == .trailing {
            horizontalMargin = position.rightMargin * scale
        } else {
            horizontalMargin = 0
        }
        let verticalMargin = position.verticalMargin * scale

        let targetX: CGFloat
        if position.horizontalAlign == .leading {
            targetX = frame.width / 2 + horizontalMargin
        } else if position.horizontalAlign == .trailing {
            targetX = bounds.width - frame.width / 2 - horizontalMargin
        } else {
            targetX = bounds.midX
        }

        let targetY: CGFloat
        if position.verticalAlign == .top {
            targetY = safeAreaInsets.top + verticalMargin + frame.height / 2
        } else if position.verticalAlign == .center {
            targetY = bounds.midY
        } else {
            targetY = bounds.height - safeAreaInsets.bottom - 5 - verticalMargin - frame.height / 2
        }

        subtitleBackView.transform = CGAffineTransform(
            translationX: targetX - frame.midX,
            y: targetY - frame.midY
        )
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
    private lazy var pipSubtitleCoordinator = ConduitKSPictureInPictureCoordinator(
        playerView: playerView,
        playerController: self
    )
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
            return ConduitKSPlayerTrack(
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
        playerView.resetSubtitlePresentationCache()
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

        let options = ConduitKSOptions(preferredAudioLanguage: preferredAudioLanguage)
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
        // KSMEPlayer applies startPlayTime inside its demux/read thread. A
        // second pre-ready layer seek races that initial seek and can leave
        // the layer buffering forever. AVPlayer does not consume this option,
        // so retain the layer fallback for that backend.
        if initialPositionMs > 0, !(layer.player is KSMEPlayer) {
            layer.seek(time: TimeInterval(initialPositionMs) / 1000.0, autoPlay: true) { _ in }
        }
        refreshPlaybackState()
    }

    func playPlayback() {
        shouldPlay = true
        activateAudioSession()
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
        activateAudioSession()
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

    fileprivate var playbackIntent: Bool { shouldPlay }

    fileprivate func setPlaybackIntent(_ playing: Bool) {
        shouldPlay = playing
        if playing {
            activateAudioSession()
            playerView.playerLayer?.play()
        } else {
            playerView.playerLayer?.pause()
        }
        refreshPlaybackState()
    }

    fileprivate func activateAudioSessionForPictureInPicture() {
        activateAudioSession()
    }

    func selectAudio(_ trackId: Int) {
        guard let layer = playerView.playerLayer,
              let track = layer.player.tracks(mediaType: .audio).first(where: { Int($0.trackID) == trackId })
        else { return }
        userSelectedAudio = true
        selectAudioTrack(track, on: layer)
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
        // KSPlayerLayer.state describes buffering/render readiness. Its
        // `isPlaying` value can be stale during PiP/lifecycle transitions;
        // the media player owns the actual play/pause state.
        isPlayerPlaying = player.isPlaying
        isPlayerEnded = layer.state == .playedToTheEnd
        durationMs = Int64(max(0, player.duration) * 1000)
        positionMs = Int64(max(0, player.currentPlaybackTime) * 1000)
        videoWidth = Int(max(0, player.naturalSize.width))
        videoHeight = Int(max(0, player.naturalSize.height))
        currentSpeed = player.playbackRate
        if ![.initialized, .preparing, .error].contains(layer.state) {
            applyPreferredTracks()
        }
        if layer.state == .error, currentErrorMessage.isEmpty {
            currentErrorMessage = "KSPlayer failed to play this media."
        }
    }

    private func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
            try session.setActive(true)
        } catch {
            print("[Conduit KSPlayer] Failed to activate audio session: \(error)")
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
        guard !userSelectedSubtitle else { return }

        let embedded = layer.player.tracks(mediaType: .subtitle)
        if didApplyPreferredTracks, playerView.srtControl.selectedSubtitleInfo != nil {
            return
        }
        let preferred = preferredLanguageCode(preferredSubtitleLanguage)
        if let track = preferred.flatMap({ preferred in
            embedded.first(where: { trackMatchesLanguage($0, preferred: preferred) })
        }) {
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
        let track = tracks.first(where: { trackMatchesLanguage($0, preferred: preferred) })
        guard let track else { return }
        // `wantedAudio` normally enables this track while the demuxer opens.
        // Do not seek again during the ready/buffering transition: an extra
        // seek here can keep the layer buffering even though audio is ready.
        if !track.isEnabled {
            layer.player.select(track: track)
        }
        didApplyPreferredAudio = tracks.contains { $0.trackID == track.trackID && $0.isEnabled }
    }

    private func selectAudioTrack(_ track: any MediaPlayerTrack, on layer: KSPlayerLayer) {
        guard !track.isEnabled else { return }
        let wasPlaying = shouldPlay || layer.player.isPlaying
        let position = max(0, layer.player.currentPlaybackTime)
        layer.player.select(track: track)
        layer.seek(time: position, autoPlay: wasPlaying) { [weak layer] finished in
            guard finished, wasPlaying else { return }
            layer?.play()
        }
    }

    fileprivate func languageCode(_ value: String) -> String? {
        conduitLanguageCode(value)
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

    private func trackMatchesLanguage(_ track: any MediaPlayerTrack, preferred: String) -> Bool {
        languageCode(track.languageCode ?? "") == preferred
            || languageCode(track.name) == preferred
            || languageCode(displayTrackTitle(track.name, language: track.languageCode ?? "", fallback: "")) == preferred
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
    private weak var playerController: ConduitKSPlayerViewController?
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
    private var subtitleOverlayVersion = 0
    private var lastRenderedSubtitleVersion = -1
    private var isPriming = false
    private var renderedFrameCount = 0
    private var pictureInPicturePossibleObservation: NSKeyValueObservation?
    private var primingTimeoutWorkItem: DispatchWorkItem?
    private var playbackWasPlaying = false
    private var pipSubtitlePart: SubtitlePart?
    private var pipSubtitleID: String?
    private var lastSubtitleRefreshTime = -Double.infinity
    private var backgroundRenderTimer: DispatchSourceTimer?
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var preservePlaybackDuringBackground = false
    private var preservePlaybackWorkItem: DispatchWorkItem?

    init(playerView: ConduitKSPlayerView, playerController: ConduitKSPlayerViewController) {
        self.playerView = playerView
        self.playerController = playerController
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
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleWillResignActive()
            }
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleDidEnterBackground()
            }
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.stopBackgroundRendering()
            }
        })
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

    deinit {
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
    }

    var isSupported: Bool {
        AVPictureInPictureController.isPictureInPictureSupported()
    }

    var isActive: Bool {
        controller?.isPictureInPictureActive == true || isPriming
    }

    func start() -> Bool {
        guard isSupported, !isActive, let playerView, let layer = playerView.playerLayer else { return false }
        playbackWasPlaying = playerController?.playbackIntent ?? layer.player.isPlaying
        // Prime the model once before PiP takes over. This is safe here
        // because the normal subtitle view and PiP otherwise share the
        // already-rendered `parts` snapshot instead of searching the same
        // embedded queue independently on every frame.
        _ = playerView.srtControl.subtitle(currentTime: layer.player.currentPlaybackTime)
        pipSubtitlePart = playerView.srtControl.parts.first
        pipSubtitleID = playerView.srtControl.selectedSubtitleInfo?.subtitleID
        lastSubtitleRefreshTime = -Double.infinity
        guard prepareVideoOutput() else { return false }
        // Let KSPlayer's own Metal output advance frames. Its normal render
        // path applies the audio/video sync policy; PiP mirrors that output.
        setUnderlyingVideoOutputPlaying(playbackWasPlaying)

        isPriming = true
        renderedFrameCount = 0
        lastSourceBuffer = nil
        subtitleOverlayVersion = 0
        lastRenderedSubtitleVersion = -1
        displayLayer.frame = playerView.bounds
        displayLayer.flush()
        setDisplayRate(playbackWasPlaying ? 1 : 0)
        displayLink?.invalidate()
        let displayLink = CADisplayLink(target: self, selector: #selector(renderFrame))
        displayLink.add(to: .main, forMode: .common)
        self.displayLink = displayLink
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.isPriming else { return }
            self.cleanup()
            self.restorePlaybackState()
        }
        primingTimeoutWorkItem = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
        renderFrame()
        attemptStart()
        return true
    }

    func stop() {
        if controller?.isPictureInPictureActive == true {
            controller?.stopPictureInPicture()
        } else {
            cleanup()
            restorePlaybackState()
        }
    }

    private func cleanup() {
        isPriming = false
        stopBackgroundRendering()
        preservePlaybackDuringBackground = false
        preservePlaybackWorkItem?.cancel()
        preservePlaybackWorkItem = nil
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
        subtitleOverlayVersion = 0
        lastRenderedSubtitleVersion = -1
        lastSubtitleRefreshTime = -Double.infinity
        pixelBufferPool = nil
        pixelBufferSize = .zero
        formatDescription = nil
        displayLayer.flushAndRemoveImage()
        setDisplayRate(0)
    }

    private func setDisplayRate(_ rate: Float) {
        guard let timebase = displayLayer.controlTimebase else { return }
        CMTimebaseSetRate(timebase, rate: Float64(rate))
    }

    private func restorePlaybackState() {
        let actualPlayerIsPlaying = playerView?.playerLayer?.player.isPlaying == true
        let shouldPlay = actualPlayerIsPlaying || playbackWasPlaying
        playbackWasPlaying = false
        setUnderlyingVideoOutputPlaying(shouldPlay)
        playerController?.setPlaybackIntent(shouldPlay)
        if let playerView, let layer = playerView.playerLayer {
            // Rebuild the normal subtitle overlay after PiP has released its
            // mirrored frame surface.
            _ = playerView.srtControl.subtitle(currentTime: layer.player.currentPlaybackTime)
            let fallback = subtitlePart(
                pipSubtitlePart,
                id: pipSubtitleID,
                at: layer.player.currentPlaybackTime,
                control: playerView.srtControl
            )
            playerView.refreshSubtitlePresentation(fallbackPart: fallback)
        }
        pipSubtitlePart = nil
        pipSubtitleID = nil
        lastSubtitleRefreshTime = -Double.infinity
    }

    private func setUnderlyingVideoOutputPlaying(_ playing: Bool) {
        guard let player = playerView?.playerLayer?.player as? KSMEPlayer else { return }
        if playing {
            player.videoOutput?.play()
        } else {
            player.videoOutput?.pause()
        }
    }

    private func handleDidEnterBackground() {
        guard isActive else { return }
        playerController?.activateAudioSessionForPictureInPicture()
        if playerController?.playbackIntent == true {
            // AVKit can ask for a paused state while the app is crossing the
            // inactive/background boundary. Reassert the user's intent once
            // the background PiP session is established.
            playerController?.setPlaybackIntent(true)
            setUnderlyingVideoOutputPlaying(true)
            setDisplayRate(1)
        }
        startBackgroundRendering()
    }

    private func handleWillResignActive() {
        guard isActive, playerController?.playbackIntent == true else { return }
        preservePlaybackDuringBackground = true
        preservePlaybackWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                self?.preservePlaybackDuringBackground = false
            }
        }
        preservePlaybackWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: workItem)
    }

    private func startBackgroundRendering() {
        guard backgroundRenderTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(
            deadline: .now(),
            repeating: .milliseconds(16),
            leeway: .milliseconds(4)
        )
        timer.setEventHandler { [weak self] in
            self?.renderBackgroundFrame()
        }
        backgroundRenderTimer = timer
        timer.resume()
    }

    private func stopBackgroundRendering() {
        backgroundRenderTimer?.cancel()
        backgroundRenderTimer = nil
        preservePlaybackDuringBackground = false
        preservePlaybackWorkItem?.cancel()
        preservePlaybackWorkItem = nil
    }

    private func renderBackgroundFrame() {
        guard isActive else {
            stopBackgroundRendering()
            return
        }
        guard playerController?.playbackIntent == true else {
            renderFrame()
            return
        }

        // MetalPlayView's CADisplayLink is tied to the app's foreground
        // display loop. When iOS stops delivering those callbacks in the
        // background, advance only frames that have fallen behind the audio
        // clock. This preserves A/V sync instead of consuming frames at a
        // fixed rate and making video run faster than audio.
        if let player = playerView?.playerLayer?.player as? KSMEPlayer,
           player.isPlaying,
           let videoOutput = player.videoOutput,
           player.currentPlaybackTime - player.displayedVideoTime > 0.05 {
            videoOutput.readNextFrame()
        }
        renderFrame()
    }

    private func prepareVideoOutput() -> Bool {
        guard let player = playerView?.playerLayer?.player else { return false }
        if let player = player as? KSMEPlayer {
            if player.videoOutput?.pixelBuffer == nil {
                player.videoOutput?.readNextFrame()
            }
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
        let subtitle = currentSubtitleOverlay(for: frame.buffer, at: frame.time.seconds)
        let hasNewVideoFrame = frame.buffer !== lastSourceBuffer
        guard hasNewVideoFrame || subtitleOverlayVersion != lastRenderedSubtitleVersion ||
              (isPriming && renderedFrameCount < 2)
        else { return }
        guard let outputBuffer = compositedBuffer(
            source: frame.buffer,
            subtitle: subtitle
        ) else { return }
        lastSourceBuffer = frame.buffer
        lastRenderedSubtitleVersion = subtitleOverlayVersion
        enqueue(outputBuffer, at: frame.time)
        renderedFrameCount += 1
        if isPriming, renderedFrameCount >= 2 {
            attemptStart()
        }
    }

    private func currentVideoFrame() -> (buffer: CVPixelBuffer, time: CMTime)? {
        guard let player = playerView?.playerLayer?.player else { return nil }
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
        let subtitleControl = playerView.srtControl
        // SubtitleInfo.search(for:) advances KSPlayer's embedded subtitle
        // queue. The normal VideoPlayerView already updates `parts`, so PiP
        // must mirror that state rather than consuming the queue a second
        // time at a slightly different timestamp.
        guard let selectedSubtitle = subtitleControl.selectedSubtitleInfo else {
            pipSubtitlePart = nil
            pipSubtitleID = nil
            if lastSubtitleKey != "" || subtitleOverlay != nil {
                lastSubtitleKey = ""
                subtitleOverlay = nil
                subtitleOverlayVersion += 1
            }
            return nil
        }
        if pipSubtitleID != selectedSubtitle.subtitleID {
            pipSubtitleID = selectedSubtitle.subtitleID
            pipSubtitlePart = nil
        }
        let subtitleTime = max(0, time - selectedSubtitle.delay - subtitleControl.subtitleDelay)
        let hasVisibleParts = subtitleControl.parts.contains {
            subtitlePartIsVisible($0, at: subtitleTime)
        }
        let hasVisibleCachedPart = subtitlePartIsVisible(pipSubtitlePart, at: subtitleTime)
        if !hasVisibleParts, !hasVisibleCachedPart,
           abs(time - lastSubtitleRefreshTime) >= 0.25 {
            // The normal KSPlayer subtitle callback can stop while PiP is
            // active. Refresh only when the cached cue has ended, and throttle
            // the lookup so embedded subtitle queues are not consumed twice
            // on every video frame.
            lastSubtitleRefreshTime = time
            _ = subtitleControl.subtitle(currentTime: time)
        }
        if let currentPart = subtitleControl.parts.first,
           subtitlePartIsVisible(currentPart, at: subtitleTime) {
            pipSubtitlePart = currentPart
        }
        guard let part = subtitlePart(
            pipSubtitlePart,
            id: pipSubtitleID,
            at: time,
            control: subtitleControl
        ) else {
            pipSubtitlePart = nil
            if lastSubtitleKey != "" || subtitleOverlay != nil {
                lastSubtitleKey = ""
                subtitleOverlay = nil
                subtitleOverlayVersion += 1
            }
            return nil
        }
        let text = part.text?.string ?? ""
        let key = "\(part.start):\(part.end):\(text)"
        guard key != lastSubtitleKey else { return subtitleOverlay }
        lastSubtitleKey = key
        subtitleOverlayVersion += 1
        let width = CVPixelBufferGetWidth(sourceBuffer)
        let height = CVPixelBufferGetHeight(sourceBuffer)
        guard width > 1, height > 1 else { return nil }
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // ASS subtitles can carry a bitmap plus text attributes that
            // UIKit interprets as expansion/shear. Re-render text cues into
            // our full-frame PiP overlay so the source bitmap cannot escape
            // the PiP bounds or appear in the top-right corner.
            subtitleOverlay = makeTextOverlay(text, width: width, height: height)
            return subtitleOverlay
        }
        if let image = part.image?.cgImage {
            subtitleOverlay = makeImageOverlay(image, width: width, height: height)
            return subtitleOverlay
        }
        if text.isEmpty {
            subtitleOverlay = nil
            return nil
        }
        subtitleOverlay = makeTextOverlay(text, width: width, height: height)
        return subtitleOverlay
    }

    private func subtitlePart(
        _ part: SubtitlePart?,
        id: String?,
        at time: TimeInterval,
        control: SubtitleModel
    ) -> SubtitlePart? {
        guard let selectedSubtitle = control.selectedSubtitleInfo,
              selectedSubtitle.subtitleID == id,
              let part
        else { return nil }
        let subtitleTime = max(0, time - selectedSubtitle.delay - control.subtitleDelay)
        return subtitlePartIsVisible(part, at: subtitleTime) ? part : nil
    }

    private func subtitlePartIsVisible(_ part: SubtitlePart?, at time: TimeInterval) -> Bool {
        guard let part else { return false }
        let tolerance = 0.25
        return part.start <= time + tolerance && part.end >= time - tolerance
    }

    private func makeTextOverlay(_ text: String, width: Int, height: Int) -> CIImage? {
        // The composited frame is later reduced to the PiP window. A normal
        // 24px subtitle therefore becomes unreadably small in PiP.
        let size = CGFloat(max(24, min(96, Double(height) * 0.09)))
        let renderer = makeOverlayRenderer(width: width, height: height)
        let image = renderer.image { _ in
            let rect = CGRect(
                x: CGFloat(width) * 0.05,
                y: CGFloat(height) * 0.76,
                width: CGFloat(width) * 0.9,
                height: CGFloat(height) * 0.2
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

    private func makeImageOverlay(_ image: CGImage, width: Int, height: Int) -> CIImage? {
        let target = CGRect(
            x: CGFloat(width) * 0.1,
            y: CGFloat(height) * 0.76,
            width: CGFloat(width) * 0.8,
            height: CGFloat(height) * 0.2
        )
        let scale = min(
            target.width / CGFloat(image.width),
            target.height / CGFloat(image.height)
        )
        guard scale.isFinite, scale > 0 else { return nil }
        let size = CGSize(
            width: CGFloat(image.width) * scale,
            height: CGFloat(image.height) * scale
        )
        let rect = CGRect(
            x: target.midX - size.width / 2,
            y: target.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
        let renderer = makeOverlayRenderer(width: width, height: height)
        let overlay = renderer.image { _ in
            UIImage(cgImage: image).draw(in: rect)
        }
        return overlay.cgImage.map(CIImage.init)
    }

    private func makeOverlayRenderer(width: Int, height: Int) -> UIGraphicsImageRenderer {
        let format = UIGraphicsImageRendererFormat()
        // The subtitle canvas is already expressed in video pixels. The
        // default UIKit renderer scale follows the device screen scale,
        // producing a 2x/3x CIImage that gets clipped and enlarged in PiP.
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        )
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
        restorePlaybackState()
    }

    func pictureInPictureController(_: AVPictureInPictureController, failedToStartPictureInPictureWithError _: Error) {
        cleanup()
        restorePlaybackState()
    }

    func pictureInPictureController(_: AVPictureInPictureController, setPlaying playing: Bool) {
        if !playing,
           playerController?.playbackIntent == true,
           preservePlaybackDuringBackground {
            // Treat the background transition's transient pause request as a
            // lifecycle callback, not as a user pause from the PiP controls.
            playerController?.setPlaybackIntent(true)
            setUnderlyingVideoOutputPlaying(true)
            setDisplayRate(1)
            return
        }
        playbackWasPlaying = playing
        setDisplayRate(playing ? 1 : 0)
        playerController?.setPlaybackIntent(playing)
        setUnderlyingVideoOutputPlaying(playing)
    }

    func pictureInPictureControllerTimeRangeForPlayback(_: AVPictureInPictureController) -> CMTimeRange {
        let duration = playerView?.playerLayer?.player.duration ?? 0
        if duration == 0 {
            return CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
        }
        return CMTimeRange(start: .zero, duration: CMTime(seconds: duration, preferredTimescale: 1_000))
    }

    func pictureInPictureControllerIsPlaybackPaused(_: AVPictureInPictureController) -> Bool {
        if let playbackIntent = playerController?.playbackIntent {
            return !playbackIntent
        }
        return playerView?.playerLayer?.player.isPlaying != true
    }

    func pictureInPictureController(_: AVPictureInPictureController, didTransitionToRenderSize _: CMVideoDimensions) {}

    func pictureInPictureController(_: AVPictureInPictureController, skipByInterval skipInterval: CMTime) async {
        guard let playerView else { return }
        await MainActor.run {
            let currentTime = playerView.playerLayer?.player.currentPlaybackTime ?? 0
            playerView.playerLayer?.seek(
                time: currentTime + skipInterval.seconds,
                autoPlay: playerController?.playbackIntent == true
            ) { _ in }
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
