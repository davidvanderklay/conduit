package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals

class TextTidyingTest {
    @Test
    fun dropsPartialWordFromPreTruncatedText() =
        assertEquals("when opposing forces…", tidyTruncatedText("when opposing forces col..."))

    @Test
    fun keepsWholeWordAndDropsTrailingPunctuation() =
        assertEquals("a battle that threatens…", tidyTruncatedText("a battle that threatens, ..."))

    @Test
    fun leavesCompleteTextAlone() = assertEquals("The end.", tidyTruncatedText(" The end. "))

    @Test
    fun keepsMultiWordNamesTogether() =
        assertEquals("New Zealand, Iceland", unbreakableNames("New Zealand, Iceland"))

    @Test
    fun shelfCaptionShowsStartYearOfRunningSeries() {
        assertEquals("2022", shelfCaption("2022–"))
        assertEquals("2019–2023", shelfCaption("2019–2023"))
    }
}
