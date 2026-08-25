package media.conduit.client.account

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
    fun doesNotMatchAChangedUrlWhenTheProviderDoesNotGiveAStableIdentity() {
        val saved = playbackSourceForStream(
            "addon-1",
            StreamItem(url = "https://video.example/movie.mp4?session=old"),
        )
        val fresh = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(url = "https://video.example/movie.mp4?session=new"),
        )

        assertNull(selectSavedStream(listOf(fresh), saved))
    }

    @Test
    fun matchesAnExactStreamFromAnotherAddOn() {
        val saved = playbackSourceForStream(
            "addon-1",
            StreamItem(url = "https://video.example/movie.mp4"),
        )
        val otherAddOn = StreamSource(
            addonId = "addon-2",
            addonName = "Other provider",
            stream = StreamItem(url = "https://video.example/movie.mp4"),
        )

        assertEquals(otherAddOn, selectSavedStream(listOf(otherAddOn), saved))
    }

    @Test
    fun continuesWithAMatchingBingeGroupFromTheSameAddOn() {
        val saved = PlaybackSource(
            addonId = "addon-1",
            sourceKey = "url:https://old.example/movie.mp4",
            kind = "url",
            bingeGroup = "series-1080p",
        )
        val otherAddOn = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(
                url = "https://new.example/movie.mp4",
                behaviorHints = StreamBehaviorHints(bingeGroup = "series-1080p"),
            ),
        )

        assertEquals(otherAddOn, selectSavedStream(listOf(otherAddOn), saved))
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

        assertNull(selectSavedStream(listOf(differentStream), saved))
    }

    @Test
    fun rejectsAChangedStreamWhenBothBingeGroupsAreAbsent() {
        val saved = playbackSourceForStream(
            "addon-1",
            StreamItem(url = "https://old.example/movie.mp4"),
        )
        val refreshed = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(url = "https://new.example/movie.mp4", name = "movie"),
        )

        assertNull(selectSavedStream(listOf(refreshed), saved))
    }

    @Test
    fun rejectsAnAmbiguousSameAddonFallbackWithoutStableMetadata() {
        val saved = PlaybackSource(
            addonId = "addon-1",
            sourceKey = "url:https://old.example/movie.mp4",
            kind = "url",
        )
        val candidates = listOf(
            StreamSource("addon-1", "Provider", StreamItem(url = "https://new.example/1080p.mp4")),
            StreamSource("addon-1", "Provider", StreamItem(url = "https://new.example/720p.mp4")),
        )

        assertNull(selectSavedStream(candidates, saved))
    }

    @Test
    fun doesNotFuzzyMatchWhenOnlyTheFilenameMatches() {
        val saved = PlaybackSource(
            addonId = "addon-1",
            sourceKey = "url:https://old.example/movie.mp4",
            kind = "url",
            filename = "movie-1080p.mp4",
        )
        val matching = StreamSource(
            "addon-1",
            "Provider",
            StreamItem(
                url = "https://new.example/1080p.mp4",
                behaviorHints = StreamBehaviorHints(filename = "movie-1080p.mp4"),
            ),
        )
        val other = StreamSource(
            "addon-1",
            "Provider",
            StreamItem(url = "https://new.example/720p.mp4", behaviorHints = StreamBehaviorHints(filename = "movie-720p.mp4")),
        )

        assertNull(selectSavedStream(listOf(other, matching), saved))
    }

    @Test
    fun autoSelectsTheOnlyFallbackStream() {
        val saved = StreamSource(
            addonId = "addon-1",
            addonName = "Provider",
            stream = StreamItem(url = "https://video.example/saved.mp4"),
        )
        val fallback = StreamSource(
            addonId = "addon-2",
            addonName = "Other provider",
            stream = StreamItem(url = "https://video.example/fallback.mp4"),
        )

        assertEquals(fallback, selectSingleAutoStream(listOf(saved, fallback), saved))
        assertNull(selectSingleAutoStream(listOf(saved, fallback)))
    }

    @Test
    fun automaticRankingPrefersSavedThenBingeGroupThenLowerQuality() {
        val saved = PlaybackSource("saved-addon", "url:https://saved.example/video", "url")
        val previous = PlaybackSource(
            addonId = "current-addon",
            sourceKey = "url:https://current.example/video",
            kind = "url",
            name = "1080p",
            bingeGroup = "show-release",
        )
        val sources = listOf(
            StreamSource("other", "Other", StreamItem(url = "https://example/4k", name = "4K")),
            StreamSource("current-addon", "Current", StreamItem(url = "https://example/720", name = "720p")),
            StreamSource(
                "other",
                "Other",
                StreamItem(
                    url = "https://example/binge",
                    name = "1080p",
                    behaviorHints = StreamBehaviorHints(bingeGroup = "show-release"),
                ),
            ),
            StreamSource("saved-addon", "Saved", StreamItem(url = "https://saved.example/video", name = "480p")),
        )

        assertEquals(
            listOf(
                "https://saved.example/video",
                "https://example/binge",
                "https://example/720",
                "https://example/4k",
            ),
            rankAutomaticStreams(sources, previous, saved).map { it.stream.url },
        )
    }

    @Test
    fun automaticRankingTriesEachNormalizedUrlOnce() {
        val duplicateWithFreshToken = listOf(
            StreamSource("one", "One", StreamItem(url = "https://example/video?token=old")),
            StreamSource("two", "Two", StreamItem(url = "https://example/video?token=new")),
        )

        assertEquals(1, rankAutomaticStreams(duplicateWithFreshToken).size)
    }
}
