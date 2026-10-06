package media.conduit.mobile

import java.text.DateFormat
import java.util.Date
import kotlin.time.Instant

internal actual fun formatSavedAt(timestamp: String): String = runCatching {
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(Date(Instant.parse(timestamp).toEpochMilliseconds()))
}.getOrDefault(timestamp)
