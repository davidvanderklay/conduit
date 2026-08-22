import XCTest
@testable import conduit

final class ConduitPipVideoRegionPolicyTests: XCTestCase {
    func testLandscapeVideoInTallerSurfaceCropsTheInlineBars() {
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 1080,
                textureHeight: 1080,
                videoWidth: 1920,
                videoHeight: 1080,
                videoFillsSurface: false
            ),
            .centeredCrop(width: 1080, height: 606)
        )
    }

    func testPortraitVideoInWiderSurfaceCropsTopAndBottom() {
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 1920,
                textureHeight: 800,
                videoWidth: 900,
                videoHeight: 1600,
                videoFillsSurface: false
            ),
            .centeredCrop(width: 450, height: 800)
        )
    }

    func testMatchingAspectsPublishTheWholeSurface() {
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 1280,
                textureHeight: 720,
                videoWidth: 3840,
                videoHeight: 2160,
                videoFillsSurface: false
            ),
            .fullSurface
        )
    }

    func testAnamorphicDisplaySizeDrivesTheCrop() {
        // 720x480 storage with 8:9 SAR displays as 4:3; cropping must follow
        // the display aspect, not the storage grid.
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 1000,
                textureHeight: 1000,
                videoWidth: 640,
                videoHeight: 480,
                videoFillsSurface: false
            ),
            .centeredCrop(width: 1000, height: 750)
        )
    }

    func testUnknownVideoSizeIsSkippedInsteadOfPublishingDeviceAspect() {
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 2532,
                textureHeight: 1170,
                videoWidth: 0,
                videoHeight: 0,
                videoFillsSurface: false
            ),
            .skip
        )
    }

    func testFillModesPublishTheWholeSurfaceEvenWithoutAVideoSize() {
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 2532,
                textureHeight: 1170,
                videoWidth: 0,
                videoHeight: 0,
                videoFillsSurface: true
            ),
            .fullSurface
        )
    }

    func testDegenerateSurfacesAreSkipped() {
        XCTAssertEqual(
            ConduitPipVideoRegionPolicy.decision(
                textureWidth: 0,
                textureHeight: 1170,
                videoWidth: 1920,
                videoHeight: 1080,
                videoFillsSurface: false
            ),
            .skip
        )
    }
}
