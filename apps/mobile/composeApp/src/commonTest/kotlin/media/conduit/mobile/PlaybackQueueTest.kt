package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import media.conduit.mobile.account.PlaybackQueueItem

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
    fun queuedEpisodeUsesShowArtworkInsteadOfEpisodeThumbnail() {
        val item = media.conduit.mobile.account.CatalogItem(
            id = "show",
            type = "series",
            name = "Show",
            poster = "https://example.test/poster.jpg",
            background = "https://example.test/background.jpg",
        )
        val video = media.conduit.mobile.account.VideoItem(
            id = "s1e1",
            title = "Episode 1",
            thumbnail = "https://example.test/episode.jpg",
        )

        assertEquals("https://example.test/background.jpg", playbackQueueItem(item, video)?.artwork)
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
