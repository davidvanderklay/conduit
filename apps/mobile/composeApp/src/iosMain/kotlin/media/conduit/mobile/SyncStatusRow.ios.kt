@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package media.conduit.mobile

import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSDateFormatterShortStyle
import platform.Foundation.dateWithTimeIntervalSince1970
import kotlin.time.Instant

internal actual fun formatSavedAt(timestamp: String): String = runCatching {
    NSDateFormatter().apply {
        dateStyle = NSDateFormatterShortStyle
        timeStyle = NSDateFormatterShortStyle
    }.stringFromDate(NSDate.dateWithTimeIntervalSince1970(Instant.parse(timestamp).toEpochMilliseconds() / 1000.0))
}.getOrDefault(timestamp)
