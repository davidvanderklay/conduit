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
}
