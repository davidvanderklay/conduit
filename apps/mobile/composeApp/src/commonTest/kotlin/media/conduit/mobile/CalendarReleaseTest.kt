package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import media.conduit.mobile.account.LibraryItemSummary
import media.conduit.mobile.account.MetaItem
import media.conduit.mobile.account.VideoItem

class CalendarReleaseTest {
    @Test
    fun shiftsMonthsAcrossYearBoundaries() {
        assertEquals(CalendarMonth(2025, 12), shiftCalendarMonth(CalendarMonth(2026, 1), -1))
        assertEquals(CalendarMonth(2027, 1), shiftCalendarMonth(CalendarMonth(2026, 12), 1))
    }

    @Test
    fun buildsASundayFirstCalendar() {
        assertEquals(1, calendarMonthOffset(CalendarMonth(2026, 6)))
        assertEquals(29, daysInCalendarMonth(CalendarMonth(2024, 2)))
        assertEquals("2026-06-03", calendarDateKey(CalendarMonth(2026, 6), 3))
    }

    @Test
    fun preservesExactReleaseDatesAndRejectsInvalidValues() {
        assertEquals("2026-06-03", releaseDateKey("2026-06-03T00:00:00.000Z"))
        assertNull(releaseDateKey("2026-02-30"))
        assertNull(releaseDateKey("sometime"))
    }

    @Test
    fun buildsMovieAndEpisodeReleasesInDateOrder() {
        val movie = LibraryItemSummary("movie", "movie", "Movie", updatedAt = "2026-01-01")
        val series = LibraryItemSummary("show", "series", "Show", updatedAt = "2026-01-01")
        val releases = buildMobileCalendarReleases(
            listOf(
                movie to MetaItem("movie", "movie", "Movie", released = "2026-08-20"),
                series to MetaItem(
                    "show",
                    "series",
                    "Show",
                    background = "background.jpg",
                    videos = listOf(
                        VideoItem("episode-2", title = "Second", season = 1, episode = 2, released = "2026-08-12"),
                        VideoItem("unknown", title = "Unknown"),
                    ),
                ),
            ),
        )

        assertEquals(listOf("2026-08-12", "2026-08-20"), releases.map { it.date })
        assertEquals("S1E2 · Second", releases.first().subtitle)
        assertEquals("background.jpg", releases.first().image)
        assertEquals("episode-2", releases.first().videoId)
    }
}
