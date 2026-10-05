@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package media.conduit.mobile

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import media.conduit.mobile.account.DiagnosticLogStore
import media.conduit.mobile.account.DiagnosticSessionFiles
import media.conduit.mobile.account.diagnosticSessionMaxBytes
import platform.Foundation.NSBundle
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.UIKit.UIDevice
import platform.posix.SEEK_END
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread
import platform.posix.fseek
import platform.posix.ftell
import platform.posix.fwrite
import platform.posix.rename
import platform.posix.rewind

internal fun startIosDiagnosticLogging() {
    val device = UIDevice.currentDevice
    val bundle = NSBundle.mainBundle
    DiagnosticLogStore.startPersistence(
        IosDiagnosticSessionFiles(NSHomeDirectory() + "/Library/Application Support/ConduitDiagnostics"),
        "iOS ${device.systemVersion} ${device.model} " +
            "app=${bundle.objectForInfoDictionaryKey("CFBundleShortVersionString")} " +
            "build=${bundle.objectForInfoDictionaryKey("CFBundleVersion")}",
    )
}

/** Native events enter the writer directly, even when Compose is not polling. */
fun redactIosDiagnosticMessage(value: String): String = media.conduit.mobile.account.sanitizeDiagnosticMessage(value)

fun recordIosDiagnosticEvent(encoded: String) {
    DiagnosticLogStore.recordNativeEvent(encoded)
}

private class IosDiagnosticSessionFiles(private val directory: String) : DiagnosticSessionFiles {
    override fun read(name: String): String? {
        val path = "$directory/$name"
        if (!NSFileManager.defaultManager.fileExistsAtPath(path)) return null
        val file = checkNotNull(fopen(path, "rb"))
        return try {
            check(fseek(file, 0, SEEK_END) == 0)
            val length = ftell(file)
            check(length in 0..diagnosticSessionMaxBytes.toLong())
            rewind(file)
            if (length == 0L) return ""
            val bytes = ByteArray(length.toInt())
            bytes.usePinned { check(fread(it.addressOf(0), 1uL, length.toULong(), file) == length.toULong()) }
            bytes.decodeToString()
        } finally {
            fclose(file)
        }
    }

    override fun write(name: String, text: String) {
        check(NSFileManager.defaultManager.createDirectoryAtPath(directory, true, null, null))
        val temporary = "$directory/$name.tmp"
        val file = checkNotNull(fopen(temporary, "wb"))
        var closed = false
        try {
            val bytes = text.encodeToByteArray()
            if (bytes.isNotEmpty()) {
                bytes.usePinned {
                    check(fwrite(it.addressOf(0), 1uL, bytes.size.toULong(), file) == bytes.size.toULong())
                }
            }
            val result = fclose(file)
            closed = true
            check(result == 0)
            check(rename(temporary, "$directory/$name") == 0)
        } finally {
            if (!closed) fclose(file)
        }
    }

    override fun delete(name: String) {
        val path = "$directory/$name"
        val manager = NSFileManager.defaultManager
        check(!manager.fileExistsAtPath(path) || manager.removeItemAtPath(path, null))
    }
}
