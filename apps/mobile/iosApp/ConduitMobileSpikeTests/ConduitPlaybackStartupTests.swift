import CoreGraphics
import XCTest
@testable import conduit

final class ConduitPlaybackStartupTests: XCTestCase {
    func testMeasuredReplacementSurfaceStartsBeforeUIKitWindowAttachment() {
        let measuredSize = CGSize(width: 1_366, height: 1_024)
        let surfaceSize = playbackSurfaceSize(viewSize: .zero, measuredSize: measuredSize)

        XCTAssertEqual(surfaceSize, measuredSize)
        XCTAssertTrue(
            shouldStartPendingLoad(surfaceSize: surfaceSize)
        )
    }

    func testAttachedUIKitSurfaceReplacesTheComposeMeasurement() {
        XCTAssertEqual(
            playbackSurfaceSize(
                viewSize: CGSize(width: 1_024, height: 768),
                measuredSize: CGSize(width: 1_366, height: 1_024)
            ),
            CGSize(width: 1_024, height: 768)
        )
    }

    func testReplacementLoadExplicitlyStartsAtBeginning() {
        XCTAssertEqual(
            playbackFileOptions(initialPositionMs: 0),
            ["pause=yes", "start=0.000"]
        )
    }

    func testReplacementLoadUsesOnlyTheRequestedResumePosition() {
        XCTAssertEqual(
            playbackFileOptions(initialPositionMs: 42_000),
            ["pause=yes", "start=42.000"]
        )
    }
}
