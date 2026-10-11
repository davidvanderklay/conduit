import XCTest
@testable import conduit

final class ConduitBackgroundAudioPolicyTests: XCTestCase {
    func testPausedPipReleasesVideoDecoderEvenDuringTransition() {
        for starting in [false, true] {
            XCTAssertFalse(shouldKeepConduitBackgroundVideo(
                shouldPlay: false,
                pictureInPictureActive: true,
                pictureInPictureStarting: starting
            ))
        }
    }

    func testPlayingPipKeepsVideoDuringStartAndActivePlayback() {
        XCTAssertTrue(shouldKeepConduitBackgroundVideo(
            shouldPlay: true, pictureInPictureActive: false, pictureInPictureStarting: true
        ))
        XCTAssertTrue(shouldKeepConduitBackgroundVideo(
            shouldPlay: true, pictureInPictureActive: true, pictureInPictureStarting: false
        ))
        XCTAssertFalse(shouldKeepConduitBackgroundVideo(
            shouldPlay: true, pictureInPictureActive: false, pictureInPictureStarting: false
        ))
    }

    func testPlayingNowPlayingItemKeepsAudioAlive() {
        XCTAssertTrue(
            shouldKeepConduitBackgroundAudio(
                hasNowPlayingItem: true,
                shouldPlay: true,
                isPlaying: true
            )
        )
    }

    func testPausedItemDoesNotHoldBackgroundAudio() {
        XCTAssertFalse(
            shouldKeepConduitBackgroundAudio(
                hasNowPlayingItem: true,
                shouldPlay: false,
                isPlaying: false
            )
        )
    }

    func testMissingMetadataDisablesBackgroundAudio() {
        XCTAssertFalse(
            shouldKeepConduitBackgroundAudio(
                hasNowPlayingItem: false,
                shouldPlay: true,
                isPlaying: true
            )
        )
    }
}
