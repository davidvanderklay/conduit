import CoreGraphics
import XCTest
@testable import conduit

final class ConduitPlaybackStartupTests: XCTestCase {
    func testPreferredAudioMatchesLanguageNamedOnlyInTitle() {
        let french = AudioSelectionCandidate(track: "fr", language: "fre", title: "French", selected: true)
        let english = AudioSelectionCandidate(track: "en", language: "", title: "English 5.1", selected: false)
        XCTAssertEqual(preferredAudio(candidates: [french, english], preferred: "en"), "en")
        XCTAssertNil(preferredAudio(candidates: [french, english], preferred: "fr"))
        XCTAssertNil(preferredAudio(candidates: [french, english], preferred: "ja"))
        XCTAssertNil(preferredAudio(candidates: [french, english], preferred: ""))
    }

    func testSubtitlePriorityWaitsForDelayedPrimaryAddon() {
        let secondary = SubtitleSelectionCandidate(track: "es", language: "spa", title: "Spanish", embedded: true)
        let primary = SubtitleSelectionCandidate(track: "en", language: "eng", title: "English", embedded: false)
        let waiting = preferredSubtitle(candidates: [secondary], primary: "English", secondary: "Spanish",
            systemLanguage: "en", embeddedReady: true, addonsReady: false)
        guard case .wait = waiting else { return XCTFail("Secondary must wait for add-on lookup") }
        let ready = preferredSubtitle(candidates: [secondary, primary], primary: "English", secondary: "Spanish",
            systemLanguage: "en", embeddedReady: true, addonsReady: true)
        guard case .select(let track) = ready else { return XCTFail("Primary add-on must win") }
        XCTAssertEqual(track, "en")
    }

    func testSubtitlePriorityPrefersEmbeddedWithinChosenLanguage() {
        let embedded = SubtitleSelectionCandidate(track: "embedded", language: "en-US", title: "English", embedded: true)
        let addon = SubtitleSelectionCandidate(track: "addon", language: "eng", title: "English", embedded: false)
        let decision = preferredSubtitle(candidates: [addon, embedded], primary: "English", secondary: "Spanish",
            systemLanguage: "en", embeddedReady: true, addonsReady: false)
        guard case .select(let track) = decision else { return XCTFail("Embedded primary is ready immediately") }
        XCTAssertEqual(track, "embedded")
        let secondary = preferredSubtitle(candidates: [addon, embedded], primary: "Japanese", secondary: "English",
            systemLanguage: "en", embeddedReady: true, addonsReady: true)
        guard case .select(let fallback) = secondary else { return XCTFail("Secondary should be selected") }
        XCTAssertEqual(fallback, "embedded")
    }

    func testSubtitlePriorityCanSelectSecondaryAddon() {
        let decision = preferredSubtitle(candidates: [SubtitleSelectionCandidate(track: "es", language: "spa", title: "", embedded: false)],
            primary: "English", secondary: "Spanish", systemLanguage: "en", embeddedReady: true, addonsReady: true)
        guard case .select(let track) = decision else { return XCTFail("Secondary add-on should be selected") }
        XCTAssertEqual(track, "es")
    }

    func testMissingPreferredSubtitleLanguagesTurnSubtitlesOff() {
        let candidates = [SubtitleSelectionCandidate(track: "ja", language: "jpn", title: "Japanese", embedded: true)]
        let decision = preferredSubtitle(candidates: candidates, primary: "English", secondary: "Spanish",
            systemLanguage: "en", embeddedReady: true, addonsReady: true)
        guard case .off = decision else { return XCTFail("Unrelated language must not be selected") }
        let none = preferredSubtitle(candidates: candidates, primary: "English", secondary: nil,
            systemLanguage: "en", embeddedReady: true, addonsReady: true)
        guard case .off = none else { return XCTFail("None must disable fallback") }
    }

    func testSubtitleSystemDefaultAndMetadataReadiness() {
        let candidates = [SubtitleSelectionCandidate(track: "es", language: "spa", title: "Spanish", embedded: true)]
        let waiting = preferredSubtitle(candidates: candidates, primary: "System default", secondary: nil,
            systemLanguage: "es-MX", embeddedReady: false, addonsReady: true)
        guard case .wait = waiting else { return XCTFail("Embedded metadata must be ready") }
        let ready = preferredSubtitle(candidates: candidates, primary: "System default", secondary: nil,
            systemLanguage: "es-MX", embeddedReady: true, addonsReady: false)
        guard case .select(let track) = ready else { return XCTFail("System language must resolve") }
        XCTAssertEqual(track, "es")
    }

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
