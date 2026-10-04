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
            ["start=0.000"]
        )
    }

    func testReplacementLoadUsesOnlyTheRequestedResumePosition() {
        XCTAssertEqual(
            playbackFileOptions(initialPositionMs: 42_000),
            ["start=42.000"]
        )
    }

    func testCustomBufferOptionsAreBoundedAndAutomaticDoesNotRetainAnOverride() {
        let custom = playbackFileOptions(initialPositionMs: 42_000, readAheadSeconds: 900, hardwareDecoding: false)
        XCTAssertTrue(custom.contains("cache-secs=120"))
        XCTAssertTrue(custom.contains("demuxer-max-bytes=64MiB"))
        XCTAssertTrue(custom.contains("demuxer-max-back-bytes=16MiB"))
        XCTAssertTrue(custom.contains("hwdec=no"))
        let automatic = playbackFileOptions(initialPositionMs: 0, readAheadSeconds: 0, hardwareDecoding: false)
        XCTAssertFalse(automatic.contains { $0.hasPrefix("cache-secs=") })
    }

    func testUnobservedFirstFrameStopsHoldingTheLoadingCover() {
        XCTAssertTrue(isInitialVideoFrameReady(presented: true, outputAge: 0))
        XCTAssertFalse(isInitialVideoFrameReady(presented: false, outputAge: 0.5))
        XCTAssertTrue(
            isInitialVideoFrameReady(
                presented: false,
                outputAge: initialVideoFramePresentationTimeout
            )
        )
    }

    func testRendererPresentationUpdatesDoNotBlockOnMain() {
        let applied = expectation(description: "Presentation updates applied on main")
        DispatchQueue.main.async {
            let layer = ConduitMetalLayer()
            layer.isOpaque = true
            layer.contentsGravity = .resize
            layer.minificationFilter = .linear
            layer.magnificationFilter = .linear
            let submitted = DispatchSemaphore(value: 0)
            DispatchQueue.global(qos: .userInitiated).async {
                layer.isOpaque = false
                layer.contentsGravity = .resizeAspect
                layer.minificationFilter = .nearest
                layer.magnificationFilter = .nearest
                submitted.signal()
            }
            XCTAssertEqual(submitted.wait(timeout: .now() + 2), .success)
            XCTAssertTrue(layer.isOpaque)
            XCTAssertEqual(layer.contentsGravity, .resize)
            XCTAssertEqual(layer.minificationFilter, .linear)
            XCTAssertEqual(layer.magnificationFilter, .linear)
            DispatchQueue.main.async {
                XCTAssertFalse(layer.isOpaque)
                XCTAssertEqual(layer.contentsGravity, .resizeAspect)
                XCTAssertEqual(layer.minificationFilter, .nearest)
                XCTAssertEqual(layer.magnificationFilter, .nearest)
                applied.fulfill()
            }
        }
        wait(for: [applied], timeout: 5)
    }

    func testRendererColorspaceReadbackAndNewerMainUpdate() {
        let applied = expectation(description: "Newer colorspace preserved")
        DispatchQueue.main.async {
            let layer = ConduitMetalLayer()
            let submitted = DispatchSemaphore(value: 0)
            DispatchQueue.global(qos: .userInitiated).async {
                layer.colorspace = CGColorSpace(name: CGColorSpace.displayP3)
                XCTAssertEqual(layer.colorspace?.name, CGColorSpace.displayP3)
                layer.colorspace = nil
                XCTAssertNil(layer.colorspace)
                submitted.signal()
            }
            XCTAssertEqual(submitted.wait(timeout: .now() + 2), .success)
            layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
            DispatchQueue.main.async {
                XCTAssertEqual(layer.colorspace?.name, CGColorSpace.sRGB)
                applied.fulfill()
            }
        }
        wait(for: [applied], timeout: 5)
    }
}
