import XCTest
@testable import ConduitMobileSpike

final class ConduitBackgroundAudioPolicyTests: XCTestCase {
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
