package media.conduit.mobile

import media.conduit.mobile.account.DiscoverCatalog
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DiscoverSelectionTest {
    private fun catalog(type: String, id: String, genres: List<String> = emptyList(), genreRequired: Boolean = false) =
        DiscoverCatalog(
            addonId = "addon",
            manifestUrl = "https://addon.example/manifest.json",
            addonName = "Addon",
            type = type,
            id = id,
            name = id,
            supportsGenre = genres.isNotEmpty(),
            genres = genres,
            genreRequired = genreRequired,
        )

    private val catalogs = listOf(
        catalog("movie", "top", genres = listOf("Drama", "Comedy")),
        catalog("movie", "new"),
        catalog("series", "by-genre", genres = listOf("Crime"), genreRequired = true),
    )

    @Test
    fun fallsBackToTheFirstTypeAndCatalog() {
        val resolved = resolveDiscoverSelection(catalogs, DiscoverSelection(type = "anime", catalogId = "missing"))
        assertEquals("movie", resolved.type)
        assertEquals("top", resolved.catalog?.id)
        assertNull(resolved.genre)
    }

    @Test
    fun aGenreAloneSelectsACatalogThatOffersIt() {
        val resolved = resolveDiscoverSelection(catalogs, DiscoverSelection(type = "movie", genre = "Comedy"))
        assertEquals("top", resolved.catalog?.id)
        assertEquals("Comedy", resolved.genre)
    }

    @Test
    fun dropsAGenreTheChosenCatalogDoesNotSupport() {
        val resolved = resolveDiscoverSelection(catalogs, DiscoverSelection("addon", "movie", "new", "Drama"))
        assertEquals("new", resolved.catalog?.id)
        assertNull(resolved.genre)
    }

    @Test
    fun aCatalogThatRequiresAGenreGetsItsFirstOne() {
        val resolved = resolveDiscoverSelection(catalogs, DiscoverSelection(type = "series"))
        assertEquals("Crime", resolved.genre)
        assertEquals(DiscoverSelection("addon", "series", "by-genre", "Crime"), resolved.selection)
    }
}
