package media.conduit.mobile

import platform.UIKit.UIViewController

/**
 * The iOS player is owned by UIKit/Swift while Compose owns the player
 * controls and the lifecycle of a playback session.
 *
 * Keeping this contract small is intentional: media frames never cross the
 * Kotlin/Native boundary and the Swift side can swap MPVKit versions without
 * changing the shared application code.
 */
interface IosPlayerBridge {
    fun createPlayerViewController(): UIViewController
    fun loadFile(
        url: String,
        initialPositionMs: Long,
        headersJson: String?,
        subtitlesJson: String?,
    )
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun seekBy(offsetMs: Long)
    fun setPlaybackSpeed(speed: Float)
    fun setMuted(muted: Boolean)
    fun setPreferredAudioLanguage(language: String)
    fun setPreferredSubtitleLanguage(language: String)
    fun setResizeMode(mode: Int) // 0 = fit, 1 = fill, 2 = zoom
    fun syncVideoSurfaceLayout(width: Double, height: Double)
    fun setInteractiveResize(active: Boolean)
    fun setImmersivePlayback(enabled: Boolean)
    fun isPictureInPictureSupported(): Boolean
    fun isPictureInPictureActive(): Boolean
    fun startPictureInPicture()
    fun stopPictureInPicture()

    fun getAudioTrackCount(): Int
    fun getAudioTrackId(at: Int): Int
    fun getAudioTrackLabel(at: Int): String
    fun getAudioTrackLang(at: Int): String
    fun getAudioTrackLanguageName(at: Int): String
    fun getAudioTrackCodec(at: Int): String
    fun getAudioTrackChannels(at: Int): String
    fun getAudioTrackChannelCount(at: Int): Int
    fun getAudioTrackSampleRate(at: Int): Int
    fun getAudioTrackBitrate(at: Int): Long
    fun isAudioTrackSelected(at: Int): Boolean
    fun getSubtitleTrackCount(): Int
    fun getSubtitleTrackId(at: Int): Int
    fun getSubtitleTrackLabel(at: Int): String
    fun getSubtitleTrackLang(at: Int): String
    fun isSubtitleTrackExternal(at: Int): Boolean
    fun isSubtitleTrackSelected(at: Int): Boolean
    fun selectAudioTrack(trackId: Int)
    fun selectSubtitleTrack(trackId: Int)

    fun getIsLoading(): Boolean
    fun getIsBuffering(): Boolean
    fun getIsPlaying(): Boolean
    fun getIsEnded(): Boolean
    fun getDurationMs(): Long
    fun getPositionMs(): Long
    fun getVideoWidth(): Int
    fun getVideoHeight(): Int
    fun getPlaybackSpeed(): Float
    fun getErrorMessage(): String
    fun destroy()
}

object IosPlayerBridgeFactory {
    private var creator: IosPlayerBridgeCreator? = null

    fun registerFactory(creator: IosPlayerBridgeCreator) {
        this.creator = creator
    }

    fun create(): IosPlayerBridge? = creator?.createBridge()
}

interface IosPlayerBridgeCreator {
    fun createBridge(): IosPlayerBridge
}
