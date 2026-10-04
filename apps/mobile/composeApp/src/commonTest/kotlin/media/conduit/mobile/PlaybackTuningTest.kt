package media.conduit.mobile

import kotlin.test.Test
import kotlin.test.assertEquals

class PlaybackTuningTest {
    @Test
    fun automaticPreservesEngineDefaultsAndCustomReadAheadKeepsMemoryLimits() {
        assertEquals(emptyMap(), PlaybackTuning().mpvBufferOptions())
        assertEquals("10", PlaybackTuning(readAheadSeconds = -5).mpvBufferOptions()["cache-secs"])
        val options = PlaybackTuning(readAheadSeconds = 900).mpvBufferOptions()
        assertEquals("120", options["cache-secs"])
        assertEquals("120", options["demuxer-readahead-secs"])
        assertEquals("64MiB", options["demuxer-max-bytes"])
        assertEquals("16MiB", options["demuxer-max-back-bytes"])
    }
}
