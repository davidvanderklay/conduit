import XCTest
@testable import conduit

final class ConduitPictureInPictureCapturePolicyTests: XCTestCase {
    func testCaptureIsDisarmedDuringOrdinaryInlinePlayback() {
        XCTAssertFalse(
            ConduitPictureInPictureCapturePolicy.isArmed(
                isPriming: false,
                isActive: false,
                burstFramesRemaining: 0
            )
        )
    }

    func testCaptureIsArmedWhilePrimingPiP() {
        XCTAssertTrue(
            ConduitPictureInPictureCapturePolicy.isArmed(
                isPriming: true,
                isActive: false,
                burstFramesRemaining: 0
            )
        )
    }

    func testCaptureIsArmedWhilePiPIsActive() {
        XCTAssertTrue(
            ConduitPictureInPictureCapturePolicy.isArmed(
                isPriming: false,
                isActive: true,
                burstFramesRemaining: 0
            )
        )
    }

    func testCaptureIsArmedForARequestedRefreshBurst() {
        XCTAssertTrue(
            ConduitPictureInPictureCapturePolicy.isArmed(
                isPriming: false,
                isActive: false,
                burstFramesRemaining: 1
            )
        )
    }
}
