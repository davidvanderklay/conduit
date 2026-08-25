import XCTest
@testable import conduit

final class ConduitPipPlaybackClockTests: XCTestCase {
    func testPictureInPictureClockInterpolatesWithPlaybackRate() {
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 1_000,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 2,
            videoFrameRate: 24,
            sampledAtUptime: 10,
            generation: 1
        )

        XCTAssertEqual(clock.interpolatedPositionSeconds(at: 10), 1, accuracy: 0.001)
        XCTAssertEqual(clock.interpolatedPositionSeconds(at: 10.25), 1.5, accuracy: 0.001)
    }

    func testPictureInPictureClockDoesNotAdvanceWhilePaused() {
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 10_000,
            durationMs: 60_000,
            isPlaying: false,
            playbackRate: 1,
            videoFrameRate: 24,
            sampledAtUptime: 10,
            generation: 1
        )

        XCTAssertEqual(clock.interpolatedPositionSeconds(at: 20), 10, accuracy: 0.001)
    }

    func testPictureInPictureClockHandlesUnsampledClock() {
        XCTAssertEqual(
            ConduitPipPlaybackClockSnapshot.empty.interpolatedPositionSeconds(at: 100),
            0,
            accuracy: 0.001
        )
    }
}
