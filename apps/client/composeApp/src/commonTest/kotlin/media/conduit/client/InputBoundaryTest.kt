package media.conduit.client

import kotlin.test.Test
import kotlin.test.assertEquals

class InputBoundaryTest {
    @Test
    fun trimsManifestUrlOnlyAtSubmissionBoundary() {
        assertEquals(
            "https://example.com/manifest.json",
            normalizeManifestUrl("  https://example.com/manifest.json\n"),
        )
    }
}
