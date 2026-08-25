import XCTest
@testable import conduit

final class ConduitRenderSizePolicyTests: XCTestCase {
    func testPendingLoadStartsWithAnyReadySurfaceWithoutWaitingForOrientation() {
        XCTAssertTrue(
            shouldStartPendingLoad(surfaceSize: CGSize(width: 768, height: 1024))
        )
        XCTAssertFalse(
            shouldStartPendingLoad(surfaceSize: CGSize(width: 1, height: 768))
        )
    }

    func testBundledCJKFontKeepsPlainTextSubtitlesAtTheIntendedSize() {
        var options: [String: String] = [:]

        ConduitSubtitleFontController().applySetupOptions { name, value in
            options[name] = value
        }

        XCTAssertEqual(options["sub-font"], "Noto Sans CJK SC")
        XCTAssertEqual(options["sub-font-size"], "54")
    }

    func testFitModeRendersAtVideoAspect() {
        // 1080p video on a taller landscape surface: buffer follows the video,
        // so the PiP window inherits the video aspect with no baked bars.
        XCTAssertEqual(
            ConduitRenderSizePolicy.decision(
                surfaceWidth: 2622,
                surfaceHeight: 1206,
                videoWidth: 1920,
                videoHeight: 1080,
                videoFillsSurface: false,
                maxLongSide: 1440
            ),
            .size(width: 1440, height: 810)
        )
    }

    func testPortraitVideoFollowsPortraitAspect() {
        XCTAssertEqual(
            ConduitRenderSizePolicy.decision(
                surfaceWidth: 1206,
                surfaceHeight: 2622,
                videoWidth: 1080,
                videoHeight: 1920,
                videoFillsSurface: false,
                maxLongSide: 1440
            ),
            .size(width: 810, height: 1440)
        )
    }

    func testFillModesRenderAtSurfaceAspect() {
        XCTAssertEqual(
            ConduitRenderSizePolicy.decision(
                surfaceWidth: 2622,
                surfaceHeight: 1206,
                videoWidth: 1920,
                videoHeight: 1080,
                videoFillsSurface: true,
                maxLongSide: 1440
            ),
            .size(width: 1440, height: 662)
        )
    }

    func testLongSideCapBoundsTheSoftwareRenderCost() {
        let decision = ConduitRenderSizePolicy.decision(
            surfaceWidth: 4000,
            surfaceHeight: 2000,
            videoWidth: 3840,
            videoHeight: 2160,
            videoFillsSurface: false,
            maxLongSide: 1000
        )
        XCTAssertEqual(decision, .size(width: 1000, height: 562))
    }

    func testSmallSurfacesAreNotUpscaled() {
        XCTAssertEqual(
            ConduitRenderSizePolicy.decision(
                surfaceWidth: 480,
                surfaceHeight: 270,
                videoWidth: 1920,
                videoHeight: 1080,
                videoFillsSurface: false,
                maxLongSide: 1440
            ),
            .size(width: 480, height: 270)
        )
    }

    func testUnknownVideoSizeFallsBackToSurfaceAspect() {
        XCTAssertEqual(
            ConduitRenderSizePolicy.decision(
                surfaceWidth: 1280,
                surfaceHeight: 720,
                videoWidth: 0,
                videoHeight: 0,
                videoFillsSurface: false,
                maxLongSide: 1440
            ),
            .size(width: 1280, height: 720)
        )
    }

    func testDegenerateInputsAreSkipped() {
        XCTAssertEqual(
            ConduitRenderSizePolicy.decision(
                surfaceWidth: 0,
                surfaceHeight: 720,
                videoWidth: 1920,
                videoHeight: 1080,
                videoFillsSurface: false,
                maxLongSide: 1440
            ),
            .skip
        )
    }
}
