package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals

class CatalogTitleTest {
    @Test
    fun labelsPopularRailsByMediaType() {
        assertEquals("Popular - Movie", formatCatalogTitle("Popular", "movie"))
        assertEquals("Popular - Series", formatCatalogTitle("Popular", "series"))
    }

    @Test
    fun avoidsDuplicateTypeSuffixes() {
        assertEquals("Popular - Movie", formatCatalogTitle("Popular - Movie", "movie"))
        assertEquals("Series", formatCatalogTitle("Series", "series"))
    }
}
