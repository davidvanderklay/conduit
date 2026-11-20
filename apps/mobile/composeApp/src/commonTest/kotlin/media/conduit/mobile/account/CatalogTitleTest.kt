package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals

class CatalogTitleTest {
    @Test
    fun labelsPopularRailsByMediaType() {
        assertEquals("Popular · Movies", formatCatalogTitle("Popular", "movie"))
        assertEquals("Popular · Series", formatCatalogTitle("Popular", "series"))
    }

    @Test
    fun avoidsDuplicateTypeSuffixes() {
        assertEquals("Popular · Movies", formatCatalogTitle("Popular - Movie", "movie"))
        assertEquals("Popular · Movies", formatCatalogTitle("Popular · Movies", "movie"))
        assertEquals("Series", formatCatalogTitle("Series", "series"))
    }
}
