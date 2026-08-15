import CoreGraphics
import CoreMedia
import CoreVideo
import XCTest
@testable import conduit

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

    func testSplitViewGeometryStartCancelsStaleRecoveryBudget() {
        var state = ConduitVideoOutputRecoveryState()
        let queuedGeneration = state.schedule(at: 10)
        XCTAssertTrue(state.markAttempt(maxAttempts: 2))

        state.cancel(resetAttempts: true)

        XCTAssertEqual(state.attempts, 0)
        XCTAssertNil(state.startedAt)
        XCTAssertEqual(state.result, .cancelled)
        XCTAssertFalse(state.isCurrent(queuedGeneration))
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

    func testPictureInPictureSchedulerFollowsSourceCadence() {
        var scheduler = ConduitPipFrameScheduler()
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 0,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 1,
            videoFrameRate: 24,
            generation: 1
        )

        XCTAssertTrue(scheduler.shouldCapture(at: 10, presentationID: 1, clock: clock))
        XCTAssertFalse(scheduler.shouldCapture(at: 10.02, presentationID: 2, clock: clock))
        XCTAssertTrue(scheduler.shouldCapture(at: 10.05, presentationID: 3, clock: clock))
        XCTAssertFalse(scheduler.shouldCapture(at: 10.05, presentationID: 3, clock: clock))
    }

    func testPictureInPictureSchedulerScalesPlaybackRateAndCapsAtSixtyHertz() {
        var scheduler = ConduitPipFrameScheduler()
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 0,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 2,
            videoFrameRate: 30,
            generation: 1
        )

        XCTAssertTrue(scheduler.shouldCapture(at: 10, presentationID: 1, clock: clock))
        XCTAssertFalse(scheduler.shouldCapture(at: 10.015, presentationID: 2, clock: clock))
        XCTAssertTrue(scheduler.shouldCapture(at: 10.017, presentationID: 3, clock: clock))
    }

    func testPictureInPictureSchedulerFallsBackForInvalidFrameRate() {
        var scheduler = ConduitPipFrameScheduler()
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 0,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 1,
            videoFrameRate: 0,
            generation: 1
        )

        XCTAssertTrue(scheduler.shouldCapture(at: 10, presentationID: 1, clock: clock))
        XCTAssertFalse(scheduler.shouldCapture(at: 10.02, presentationID: 2, clock: clock))
        XCTAssertTrue(scheduler.shouldCapture(at: 10.04, presentationID: 3, clock: clock))
    }

    func testPictureInPictureTimestampEstimatorUsesPlaybackRate() {
        var estimator = ConduitPipTimestampEstimator()
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 1_000,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 2,
            videoFrameRate: 24,
            generation: 1
        )

        XCTAssertEqual(
            CMTimeGetSeconds(estimator.timestamp(for: clock, at: 10)),
            1,
            accuracy: 0.001
        )
        XCTAssertEqual(
            CMTimeGetSeconds(estimator.timestamp(for: clock, at: 10.25)),
            1.5,
            accuracy: 0.001
        )
    }

    func testPictureInPictureTimestampEstimatorResetsOnClockGeneration() {
        var estimator = ConduitPipTimestampEstimator()
        let firstClock = ConduitPipPlaybackClockSnapshot(
            positionMs: 10_000,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 1,
            videoFrameRate: 24,
            generation: 1
        )
        let seekedClock = ConduitPipPlaybackClockSnapshot(
            positionMs: 2_000,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 1,
            videoFrameRate: 24,
            generation: 2
        )

        _ = estimator.timestamp(for: firstClock, at: 10)
        XCTAssertEqual(
            CMTimeGetSeconds(estimator.timestamp(for: seekedClock, at: 11)),
            2,
            accuracy: 0.001
        )
    }

    func testPictureInPictureTimestampEstimatorResetsOnMaterialBackwardClockJump() {
        var estimator = ConduitPipTimestampEstimator()
        let clock = ConduitPipPlaybackClockSnapshot(
            positionMs: 10_000,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 1,
            videoFrameRate: 24,
            generation: 1
        )
        let correctedClock = ConduitPipPlaybackClockSnapshot(
            positionMs: 2_000,
            durationMs: 60_000,
            isPlaying: true,
            playbackRate: 1,
            videoFrameRate: 24,
            generation: 1
        )

        _ = estimator.timestamp(for: clock, at: 10)
        XCTAssertEqual(
            CMTimeGetSeconds(estimator.timestamp(for: correctedClock, at: 11)),
            2,
            accuracy: 0.001
        )
        XCTAssertTrue(estimator.didDetectTimelineDiscontinuity)
    }

    func testPictureInPictureTimestampEstimatorDoesNotAdvanceWhilePaused() {
        var estimator = ConduitPipTimestampEstimator()
        let pausedClock = ConduitPipPlaybackClockSnapshot(
            positionMs: 10_000,
            durationMs: 60_000,
            isPlaying: false,
            playbackRate: 1,
            videoFrameRate: 24,
            generation: 1
        )

        _ = estimator.timestamp(for: pausedClock, at: 10)
        XCTAssertEqual(
            CMTimeGetSeconds(estimator.timestamp(for: pausedClock, at: 20)),
            10.001,
            accuracy: 0.001
        )
        XCTAssertFalse(estimator.didDetectTimelineDiscontinuity)
    }

    func testPictureInPictureSetupAllocationFailuresAreNotBackpressureDrops() {
        XCTAssertEqual(
            ConduitPipAllocationPolicy.disposition(
                for: kCVReturnAllocationFailed,
                duringSetup: true
            ),
            .fail
        )
        XCTAssertEqual(
            ConduitPipAllocationPolicy.disposition(
                for: kCVReturnAllocationFailed,
                duringSetup: false
            ),
            .drop
        )
    }

    func testPictureInPictureRecoveryAllowsOneAttemptForActiveCapture() {
        var policy = ConduitPipCaptureRecoveryPolicy()

        XCTAssertEqual(
            policy.action(for: .rePrime, isActive: true),
            .rePrime(active: true)
        )
        XCTAssertEqual(
            policy.action(for: .rePrime, isActive: true),
            .fail
        )

        policy.reset()
        XCTAssertEqual(
            policy.action(for: .rePrime, isActive: false),
            .rePrime(active: false)
        )
        XCTAssertEqual(
            policy.action(for: .fatal, isActive: false),
            .fail
        )
    }

    func testPictureInPictureMetricsTrackDropsFailuresAndReprimeAttempts() {
        let metrics = ConduitPipCaptureMetrics()
        metrics.recordEnqueuedFrame()
        metrics.recordDrop()
        metrics.recordFailure()
        metrics.recordReprimeAttempt()
        metrics.recordCaptureContext(
            sourceFrameRate: 24,
            effectiveCaptureInterval: 1.0 / 24.0,
            drawableWidth: 1_920,
            drawableHeight: 1_080,
            bufferWidth: 1_920,
            bufferHeight: 1_080,
            clockGeneration: 7
        )

        XCTAssertEqual(
            metrics.snapshot(),
            ConduitPipCaptureMetricsSnapshot(
                enqueuedFrames: 1,
                droppedFrames: 1,
                failures: 1,
                reprimeAttempts: 1,
                sourceFrameRate: 24,
                effectiveCaptureInterval: 1.0 / 24.0,
                drawableWidth: 1_920,
                drawableHeight: 1_080,
                bufferWidth: 1_920,
                bufferHeight: 1_080,
                clockGeneration: 7
            )
        )
    }
}
