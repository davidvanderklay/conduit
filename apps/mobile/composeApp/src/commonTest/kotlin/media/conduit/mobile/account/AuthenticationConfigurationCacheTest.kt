package media.conduit.mobile.account

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import media.conduit.mobile.foundation.MemorySettingsStore

class AuthenticationConfigurationCacheTest {
    @Test
    fun storesConfigurationPerServer() {
        val cache = AuthenticationConfigurationCache(MemorySettingsStore())
        val first = AuthenticationConfiguration(
            needsOwner = false,
            localRegistration = true,
            oidc = OidcConfiguration(true, "google", "Continue with Google"),
        )
        val second = AuthenticationConfiguration(
            needsOwner = true,
            localRegistration = false,
            oidc = OidcConfiguration(false),
        )

        cache.save("https://one.example", first)
        cache.save("https://two.example", second)

        assertEquals(first, cache.load("https://one.example"))
        assertEquals(second, cache.load("https://two.example"))
        assertNull(cache.load("https://unknown.example"))
    }
}
