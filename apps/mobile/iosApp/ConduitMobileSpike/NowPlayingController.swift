import Foundation
import MediaPlayer
import UIKit

func shouldKeepConduitBackgroundAudio(
    hasNowPlayingItem: Bool,
    shouldPlay: Bool,
    isPlaying: Bool
) -> Bool {
    hasNowPlayingItem && (shouldPlay || isPlaying)
}

final class ConduitNowPlayingController {
    private struct Metadata {
        let title: String
        let subtitle: String?
        let artworkURL: String?
    }

    private struct RemoteTarget {
        let command: MPRemoteCommand
        let token: Any
    }

    private weak var owner: ConduitMPVPlayerViewController?
    private var metadata: Metadata?
    private var positionMs: Int64 = 0
    private var durationMs: Int64 = 0
    private var playing = false
    private var playbackSpeed: Float = 1
    private var artwork: UIImage?
    private var artworkTask: URLSessionDataTask?
    private var artworkGeneration = 0
    private var remoteTargets: [RemoteTarget] = []

    var isActive: Bool { metadata != nil }

    init(owner: ConduitMPVPlayerViewController) {
        self.owner = owner
        configureRemoteCommands()
    }

    deinit {
        invalidate()
    }

    func updateMetadata(title: String, subtitle: String?, artworkURL: String?) {
        runOnMain { [weak self] in
            guard let self else { return }
            let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedTitle.isEmpty else {
                self.clear()
                return
            }
            let normalizedSubtitle = subtitle?.trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty
            let normalizedArtworkURL = artworkURL?.trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty
            let artworkChanged = self.metadata?.artworkURL != normalizedArtworkURL
            self.metadata = Metadata(
                title: normalizedTitle,
                subtitle: normalizedSubtitle,
                artworkURL: normalizedArtworkURL
            )
            UIApplication.shared.beginReceivingRemoteControlEvents()
            if artworkChanged {
                self.artwork = nil
                self.loadArtwork(normalizedArtworkURL)
            }
            self.publish()
        }
    }

    func syncPlayback(
        positionMs: Int64,
        durationMs: Int64,
        playing: Bool,
        playbackSpeed: Float
    ) {
        runOnMain { [weak self] in
            guard let self, self.metadata != nil else { return }
            self.positionMs = max(positionMs, 0)
            self.durationMs = max(durationMs, 0)
            self.playing = playing
            self.playbackSpeed = max(playbackSpeed, 0.1)
            self.publish()
        }
    }

    func clear() {
        runOnMain { [weak self] in
            guard let self else { return }
            self.artworkGeneration += 1
            self.artworkTask?.cancel()
            self.artworkTask = nil
            self.metadata = nil
            self.artwork = nil
            self.positionMs = 0
            self.durationMs = 0
            self.playing = false
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            UIApplication.shared.endReceivingRemoteControlEvents()
        }
    }

    func invalidate() {
        clear()
        runOnMain { [weak self] in self?.removeRemoteCommands() }
    }

    private func publish() {
        guard let metadata else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: metadata.title,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(positionMs) / 1000,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? Double(playbackSpeed) : 0,
            MPNowPlayingInfoPropertyIsLiveStream: durationMs <= 0,
        ]
        if let subtitle = metadata.subtitle {
            info[MPMediaItemPropertyArtist] = subtitle
        }
        if durationMs > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = Double(durationMs) / 1000
        }
        if let artwork {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artwork.size) { _ in artwork }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.skipForwardCommand.isEnabled = true
        center.skipBackwardCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]

        addTarget(center.playCommand) { [weak self] _ in
            DispatchQueue.main.async { self?.owner?.playPlayback() }
            return .success
        }
        addTarget(center.pauseCommand) { [weak self] _ in
            DispatchQueue.main.async { self?.owner?.pausePlayback() }
            return .success
        }
        addTarget(center.togglePlayPauseCommand) { [weak self] _ in
            DispatchQueue.main.async {
                guard let owner = self?.owner else { return }
                if owner.isPlayerPlaying { owner.pausePlayback() } else { owner.playPlayback() }
            }
            return .success
        }
        addTarget(center.skipForwardCommand) { [weak self] event in
            guard let event = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
            DispatchQueue.main.async { self?.owner?.seekByMs(Int64(event.interval * 1000)) }
            return .success
        }
        addTarget(center.skipBackwardCommand) { [weak self] event in
            guard let event = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
            DispatchQueue.main.async { self?.owner?.seekByMs(-Int64(event.interval * 1000)) }
            return .success
        }
        addTarget(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            DispatchQueue.main.async { self?.owner?.seekToMs(Int64(event.positionTime * 1000)) }
            return .success
        }
    }

    private func addTarget(
        _ command: MPRemoteCommand,
        handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus
    ) {
        let token = command.addTarget(handler: handler)
        remoteTargets.append(RemoteTarget(command: command, token: token))
    }

    private func removeRemoteCommands() {
        remoteTargets.forEach { $0.command.removeTarget($0.token) }
        remoteTargets.removeAll()
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = false
        center.pauseCommand.isEnabled = false
        center.togglePlayPauseCommand.isEnabled = false
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
        center.changePlaybackPositionCommand.isEnabled = false
    }

    private func loadArtwork(_ urlString: String?) {
        artworkGeneration += 1
        let generation = artworkGeneration
        artworkTask?.cancel()
        artworkTask = nil
        guard let urlString, let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        artworkTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard
                let self,
                let response = response as? HTTPURLResponse,
                200..<300 ~= response.statusCode,
                let data,
                data.count <= 12 * 1024 * 1024,
                let image = UIImage(data: data)
            else { return }
            DispatchQueue.main.async {
                guard generation == self.artworkGeneration, self.metadata?.artworkURL == urlString else { return }
                self.artwork = image
                self.publish()
            }
        }
        artworkTask?.resume()
    }

    private func runOnMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
