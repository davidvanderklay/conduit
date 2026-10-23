import AVFoundation
import XCTest
@testable import conduit

final class ConduitAudioSessionTests: XCTestCase {
    func testLockUnlockCycleChangesMixingWithoutChangingPlaybackCategory() throws {
        let session = AVAudioSession.sharedInstance()
        let previousCategory = session.category
        let previousMode = session.mode
        let previousOptions = session.categoryOptions
        let previousBufferDuration = session.preferredIOBufferDuration
        defer {
            try? session.setCategory(previousCategory, mode: previousMode, options: previousOptions)
            try? session.setPreferredIOBufferDuration(previousBufferDuration)
        }

        // Starting playback unlocked, locking, then unlocking without reopening the player.
        for mixWithOthers in [true, false, true] {
            try ConduitAudioSession.configureForPlayback(session, mixWithOthers: mixWithOthers)
            XCTAssertEqual(session.category, .playback)
            XCTAssertEqual(session.mode, .moviePlayback)
            XCTAssertEqual(session.categoryOptions.contains(.mixWithOthers), mixWithOthers)
            XCTAssertEqual(session.preferredIOBufferDuration, 0.06, accuracy: 0.001)
        }
    }
}
