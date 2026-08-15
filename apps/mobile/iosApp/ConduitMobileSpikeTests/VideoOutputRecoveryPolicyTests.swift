import CoreGraphics
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

    func testRepeatedGeometryChangesCoalesceUntilThePendingSizeChanges() {
        let firstSize = CGSize(width: 1_024, height: 768)
        let nextSize = CGSize(width: 900, height: 768)

        XCTAssertTrue(
            ConduitSurfaceTransitionPolicy.shouldScheduleDrawableResize(
                size: firstSize,
                pendingSize: nil,
                hasPendingResize: false,
            )
        )
        XCTAssertFalse(
            ConduitSurfaceTransitionPolicy.shouldScheduleDrawableResize(
                size: firstSize,
                pendingSize: firstSize,
                hasPendingResize: true,
            )
        )
        XCTAssertTrue(
            ConduitSurfaceTransitionPolicy.shouldScheduleDrawableResize(
                size: nextSize,
                pendingSize: firstSize,
                hasPendingResize: true,
            )
        )
    }

    func testRecoveryCancellationClearsBudgetForEveryLifecycleExit() {
        for lifecycleExit in ["pause", "pip", "close", "new-load"] {
            var state = ConduitVideoOutputRecoveryState()
            state.schedule(at: 10)
            XCTAssertTrue(state.markAttempt(maxAttempts: 2), lifecycleExit)

            state.cancel(resetAttempts: true)

            XCTAssertEqual(state.attempts, 0, lifecycleExit)
            XCTAssertNil(state.startedAt, lifecycleExit)
            XCTAssertEqual(state.result, .cancelled, lifecycleExit)
            XCTAssertFalse(state.failed, lifecycleExit)
        }
    }

    func testSuccessfulRecoveryCompletesWithoutEnteringFailureState() {
        var state = ConduitVideoOutputRecoveryState()
        state.beginRetry(at: 10)
        XCTAssertTrue(state.markAttempt(maxAttempts: 2))

        state.succeed()

        XCTAssertEqual(state.result, .succeeded)
        XCTAssertEqual(state.attempts, 0)
        XCTAssertNil(state.startedAt)
        XCTAssertFalse(state.failed)
    }

    func testHealthySteadyPlaybackDoesNotClaimARebindSucceeded() {
        var state = ConduitVideoOutputRecoveryState()
        let decision = ConduitVideoOutputWatchdogPolicy.decision(
            surfaceTransitionInProgress: false,
            mediaClockAdvancing: true,
            heartbeatFresh: true,
            heartbeatChanged: false,
            recoveryAttempts: state.attempts,
            maxRecoveryAttempts: 2,
            recoveryStarted: state.isActive,
            recoveryElapsed: nil,
            recoveryTimeout: 1.5,
        )

        if decision == .healthy, state.isActive { state.succeed() }

        XCTAssertEqual(state.result, .none)
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
                recoveryStarted: false,
                recoveryElapsed: nil,
                recoveryTimeout: 1.5,
            ),
            .wait,
        )
    }

    func testWatchdogWaitsDuringASettlingSurfaceTransition() {
        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: true,
                mediaClockAdvancing: false,
                heartbeatFresh: false,
                heartbeatChanged: false,
                recoveryAttempts: 2,
                maxRecoveryAttempts: 2,
                recoveryStarted: true,
                recoveryElapsed: 10,
                recoveryTimeout: 1.5,
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
                recoveryStarted: true,
                recoveryElapsed: 0.5,
                recoveryTimeout: 1.5,
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
                recoveryStarted: false,
                recoveryElapsed: nil,
                recoveryTimeout: 1.5,
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
                recoveryStarted: true,
                recoveryElapsed: 0.5,
                recoveryTimeout: 1.5,
            ),
            .pause,
        )
    }

    func testStalledClockAfterRebindStillReachesTheRecoveryDeadline() {
        var state = ConduitVideoOutputRecoveryState()
        state.schedule(at: 0)
        XCTAssertTrue(state.markAttempt(maxAttempts: 2))

        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: false,
                mediaClockAdvancing: false,
                heartbeatFresh: false,
                heartbeatChanged: false,
                recoveryAttempts: state.attempts,
                maxRecoveryAttempts: 2,
                recoveryStarted: state.isActive,
                recoveryElapsed: 0.5 - (state.startedAt ?? 0),
                recoveryTimeout: 1.5,
            ),
            .wait,
        )
        XCTAssertEqual(
            ConduitVideoOutputWatchdogPolicy.decision(
                surfaceTransitionInProgress: false,
                mediaClockAdvancing: false,
                heartbeatFresh: false,
                heartbeatChanged: false,
                recoveryAttempts: state.attempts,
                maxRecoveryAttempts: 2,
                recoveryStarted: state.isActive,
                recoveryElapsed: 1.5 - (state.startedAt ?? 0),
                recoveryTimeout: 1.5,
            ),
            .pause,
        )
    }
}
