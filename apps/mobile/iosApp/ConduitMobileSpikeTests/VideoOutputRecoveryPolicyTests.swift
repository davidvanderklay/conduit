import XCTest
@testable import ConduitMobileSpike

final class VideoOutputRecoveryPolicyTests: XCTestCase {
    func testDrawableWaitsForEveryTransitionOwnerToSettle() {
        XCTAssertFalse(
            ConduitSurfaceTransitionPolicy.canApplyDrawable(
                interactiveResizeActive: true,
                surfaceTransitionActive: false,
                coordinatorSurfaceTransitionActive: false,
            )
        )
        XCTAssertFalse(
            ConduitSurfaceTransitionPolicy.canApplyDrawable(
                interactiveResizeActive: false,
                surfaceTransitionActive: true,
                coordinatorSurfaceTransitionActive: false,
            )
        )
        XCTAssertFalse(
            ConduitSurfaceTransitionPolicy.canApplyDrawable(
                interactiveResizeActive: false,
                surfaceTransitionActive: false,
                coordinatorSurfaceTransitionActive: true,
            )
        )
        XCTAssertTrue(
            ConduitSurfaceTransitionPolicy.canApplyDrawable(
                interactiveResizeActive: false,
                surfaceTransitionActive: false,
                coordinatorSurfaceTransitionActive: false,
            )
        )
    }

    func testAudioOnlyAndPiPPlaybackAreExcludedFromVideoWatchdog() {
        XCTAssertFalse(
            ConduitVideoOutputWatchdogPolicy.shouldWatch(
                hasLoadedFile: true,
                hasVideoStream: false,
                shouldPlay: true,
                waitingForInitialVideoFrame: false,
                recoveryFailed: false,
                pictureInPictureActive: false,
                destroyStarted: false,
            )
        )
        XCTAssertFalse(
            ConduitVideoOutputWatchdogPolicy.shouldWatch(
                hasLoadedFile: true,
                hasVideoStream: true,
                shouldPlay: true,
                waitingForInitialVideoFrame: false,
                recoveryFailed: false,
                pictureInPictureActive: true,
                destroyStarted: false,
            )
        )
    }

    func testWatchdogWaitsForClockProgressBeforeCallingOutputStalled() {
        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: false,
                mediaClockAdvancing: false,
                heartbeatFresh: false,
                heartbeatChanged: false,
                recoveryAttempts: 0,
                maxRecoveryAttempts: 2,
            ),
            .wait,
        )
    }

    func testFreshHeartbeatMarksARecoveryHealthy() {
        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: false,
                mediaClockAdvancing: true,
                heartbeatFresh: true,
                heartbeatChanged: false,
                recoveryAttempts: 1,
                maxRecoveryAttempts: 2,
            ),
            .healthy,
        )
    }

    func testStaleHeartbeatRecoversBeforePausingAndPausesAfterLimit() {
        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: false,
                mediaClockAdvancing: true,
                heartbeatFresh: false,
                heartbeatChanged: false,
                recoveryAttempts: 0,
                maxRecoveryAttempts: 2,
            ),
            .recover,
        )
        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: false,
                mediaClockAdvancing: true,
                heartbeatFresh: false,
                heartbeatChanged: false,
                recoveryAttempts: 2,
                maxRecoveryAttempts: 2,
            ),
            .pause,
        )
    }
}
