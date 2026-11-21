package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals

class CompactRuntimeTest {
    @Test
    fun formatsMinuteRuntimes() {
        assertEquals("2h 53m", compactRuntime("173 min"))
        assertEquals("47m", compactRuntime("47 min"))
        assertEquals("2h", compactRuntime("120 min"))
    }

    @Test
    fun leavesOtherFormatsAlone() = assertEquals("1h 30m 12s", compactRuntime("1h 30m 12s"))
}
