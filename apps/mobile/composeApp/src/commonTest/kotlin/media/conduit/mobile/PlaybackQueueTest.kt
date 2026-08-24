package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import media.conduit.mobile.account.PlaybackQueueItem
import media.conduit.mobile.account.VideoItem

class PlaybackQueueTest {
    private val first = PlaybackQueueItem("series", "show", "s1e1", "Show")
    private val second = PlaybackQueueItem("movie", "movie", "movie", "Movie")

    @Test
    fun addPreventsDuplicatesAndMoveToFrontPreservesEverythingElse() {
        assertEquals(listOf(first), listOf(first).addToQueue(first))
        assertEquals(listOf(second, first), listOf(first, second).moveToQueueFront(second))
    }

    @Test
    fun dragReordersWithoutDroppingItems() {
        val third = PlaybackQueueItem("series", "other", "s2e1", "Other")

        assertEquals(listOf(second, third, first), listOf(first, second, third).moveQueueItem(0, 2))
    }

    @Test
    fun seriesCoversCannotBeQueuedWithoutAnEpisode() {
        assertEquals(null, playbackQueueItem(media.conduit.mobile.account.CatalogItem("show", "series", "Show")))
    }

    @Test
    fun unreleasedEpisodesCannotBeQueued() {
        assertFalse(canQueueEpisode(VideoItem("future", released = "2026-09-01"), today = "2026-08-20"))
        assertTrue(canQueueEpisode(VideoItem("released", released = "2026-08-19"), today = "2026-08-20"))
    }

    @Test
    fun queuedEpisodesPreferEpisodeThumbnailAndFallBackToShowBackground() {
        val item = media.conduit.mobile.account.CatalogItem(
            id = "show",
            type = "series",
            name = "Show",
            poster = "https://example.test/poster.jpg",
            background = "https://example.test/background.jpg",
        )
        val thumbnailed = media.conduit.mobile.account.VideoItem(
            id = "s1e1",
            title = "Episode 1",
            thumbnail = "https://example.test/episode.jpg",
        )
        val plain = media.conduit.mobile.account.VideoItem(id = "s1e2", title = "Episode 2")

        assertEquals("https://example.test/episode.jpg", playbackQueueItem(item, thumbnailed)?.artwork)
        assertEquals("https://example.test/background.jpg", playbackQueueItem(item, plain)?.artwork)
    }

    @Test
    fun playbackTitleIncludesEpisodeCoordinatesBeforePlaybackStarts() {
        assertEquals(
            "The Return - (2x3)",
            playbackTitle("The Return", "Other Show", season = 2, episode = 3),
        )
        assertEquals(
            "Other Show",
            playbackTitle(null, "Other Show", season = null, episode = null),
        )
    }

    @Test
    fun successfulPlaybackConsumesMatchingItemEvenWhenOpenedNormally() {
        assertEquals(
            listOf(second),
            queueAfterPlaybackStarted(listOf(first, second), mediaId = "show", videoId = "s1e1"),
        )
    }

    @Test
    fun nextQueuedItemNeverReturnsTheCurrentlyPlayingItem() {
        assertEquals(
            second,
            nextQueuedItem(listOf(first, second), mediaId = "show", videoId = "s1e1"),
        )
    }
}
