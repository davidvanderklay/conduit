import CoreMedia
import Foundation

struct ConduitPipPlaybackClockSnapshot: Equatable {
    let positionMs: Int64
    let durationMs: Int64
    let isPlaying: Bool
    let playbackRate: Double
    let videoFrameRate: Double
    let sampledAtUptime: TimeInterval
    let generation: UInt64

    static let empty = ConduitPipPlaybackClockSnapshot(
        positionMs: 0,
        durationMs: 0,
        isPlaying: false,
        playbackRate: 1,
        videoFrameRate: 30,
        sampledAtUptime: 0,
        generation: 0
    )

    /// MPV's clock advances between refresh polls, so sample timestamps are
    /// extrapolated from the last poll instead of stepping at poll cadence.
    func interpolatedPositionSeconds(at uptime: TimeInterval) -> Double {
        guard sampledAtUptime > 0 else { return Double(positionMs) / 1_000 }
        let elapsed = max(0, uptime - sampledAtUptime)
        guard isPlaying, playbackRate > 0 else { return Double(positionMs) / 1_000 }
        return (Double(positionMs) + elapsed * 1_000 * playbackRate) / 1_000
    }
}

/// Publishes the MPV clock to the render thread without exposing the player
/// controller's mutable state to rendering work.
final class ConduitPipPlaybackClock {
    private let lock = NSLock()
    private var value = ConduitPipPlaybackClockSnapshot.empty
    private var generation: UInt64 = 0

    func update(
        positionMs: Int64,
        durationMs: Int64,
        isPlaying: Bool,
        playbackRate: Double,
        videoFrameRate: Double
    ) {
        lock.lock()
        generation &+= 1
        value = ConduitPipPlaybackClockSnapshot(
            positionMs: max(positionMs, 0),
            durationMs: max(durationMs, 0),
            isPlaying: isPlaying,
            playbackRate: playbackRate > 0 ? playbackRate : 1,
            videoFrameRate: videoFrameRate > 0 ? videoFrameRate : 30,
            sampledAtUptime: ProcessInfo.processInfo.systemUptime,
            generation: generation
        )
        lock.unlock()
    }

    func reset(positionMs: Int64? = nil) {
        lock.lock()
        generation &+= 1
        value = ConduitPipPlaybackClockSnapshot(
            positionMs: max(positionMs ?? value.positionMs, 0),
            durationMs: value.durationMs,
            isPlaying: value.isPlaying,
            playbackRate: value.playbackRate,
            videoFrameRate: value.videoFrameRate,
            sampledAtUptime: ProcessInfo.processInfo.systemUptime,
            generation: generation
        )
        lock.unlock()
    }

    func snapshot() -> ConduitPipPlaybackClockSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
