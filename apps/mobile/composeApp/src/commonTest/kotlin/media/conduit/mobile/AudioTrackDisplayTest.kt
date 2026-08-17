package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals

class AudioTrackDisplayTest {
    @Test
    fun formatsTechnicalMetadataAndFullLanguage() {
        assertEquals(
            AudioTrackDisplay(
                primary = "Dolby Digital (5.1(side), 48 kHz, 640 kbps, AC-3)",
                secondary = "Hungarian",
            ),
            audioTrackDisplay(
                AudioTrackDisplayInfo(
                    title = "Dolby Digital",
                    languageCode = "hu",
                    languageName = "Hungarian",
                    codec = "ac3",
                    channels = "5.1(side)",
                    channelCount = 6,
                    sampleRate = 48_000,
                    bitrate = 640_000,
                ),
                fallback = "Audio 1",
            ),
        )
    }

    @Test
    fun appendsCodecToLanguageOnlyTitle() {
        assertEquals(
            AudioTrackDisplay(primary = "English (7.1, TrueHD)", secondary = "English"),
            audioTrackDisplay(
                AudioTrackDisplayInfo(
                    title = "English",
                    languageCode = "en",
                    languageName = "English",
                    codec = "truehd",
                    channelCount = 8,
                ),
                fallback = "Audio 1",
            ),
        )
    }

    @Test
    fun replacesPublisherDomainWithTrackLanguage() {
        assertEquals(
            AudioTrackDisplay(
                primary = "Tamil (Stereo, 48 kHz, 320 kbps, AC-3)",
                secondary = "Tamil",
            ),
            audioTrackDisplay(
                AudioTrackDisplayInfo(
                    title = "www.1TamilBlasters.land",
                    languageCode = "ta",
                    languageName = "Tamil",
                    codec = "ac3",
                    channelCount = 2,
                    sampleRate = 48_000,
                    bitrate = 320_000,
                ),
                fallback = "Audio 1",
            ),
        )
    }
}
