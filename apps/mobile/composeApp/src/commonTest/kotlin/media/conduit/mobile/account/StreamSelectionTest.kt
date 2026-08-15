package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class StreamSelectionTest {
    @Test
    fun matchesARefreshedUrlWithoutTransientTokens() {
        val saved = playbackSourceForStream(
            "addon-1",
            StreamItem(url = "https://video.example/movie.m3u8?token=old&quality=1080p"),
        )
        val fresh = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(url = "https://video.example/movie.m3u8?token=new&quality=1080p"),
        )

        assertEquals(fresh, selectSavedStream(listOf(fresh), saved))
    }

    @Test
    fun matchesAProviderUrlWhenAnUnrecognizedQueryTokenRotates() {
        val saved = playbackSourceForStream(
            "addon-1",
            StreamItem(url = "https://video.example/movie.mp4?session=old"),
        )
        val fresh = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(url = "https://video.example/movie.mp4?session=new"),
        )

        assertEquals(fresh, selectSavedStream(listOf(fresh), saved))
    }

    @Test
    fun doesNotMatchAStreamFromAnotherAddOn() {
        val saved = playbackSourceForStream(
            "addon-1",
            StreamItem(url = "https://video.example/movie.mp4"),
        )
        val otherAddOn = StreamSource(
            addonId = "addon-2",
            addonName = "Other provider",
            stream = StreamItem(url = "https://video.example/movie.mp4"),
        )

        assertNull(selectSavedStream(listOf(otherAddOn), saved))
    }

    @Test
    fun continuesWithAMatchingBingeGroupFromAnotherAddOn() {
        val saved = PlaybackSource(
            addonId = "addon-1",
            sourceKey = "url:https://old.example/movie.mp4",
            kind = "url",
            bingeGroup = "series-1080p",
        )
        val otherAddOn = StreamSource(
            addonId = "addon-2",
            addonName = "Other provider",
            stream = StreamItem(
                url = "https://new.example/movie.mp4",
                behaviorHints = StreamBehaviorHints(bingeGroup = "series-1080p"),
            ),
        )

        assertEquals(otherAddOn, selectSavedStream(listOf(otherAddOn), saved, allowAddonFallback = true))
    }

    @Test
    fun rejectsADifferentBingeGroupDuringAddonFallback() {
        val saved = PlaybackSource(
            addonId = "addon-1",
            sourceKey = "url:https://old.example/movie.mp4",
            kind = "url",
            bingeGroup = "series-1080p",
        )
        val differentStream = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(
                url = "https://new.example/movie.mp4",
                name = "same filename metadata",
                behaviorHints = StreamBehaviorHints(bingeGroup = "series-4k"),
            ),
        )

        assertNull(selectSavedStream(listOf(differentStream), saved, allowAddonFallback = true))
    }
}
