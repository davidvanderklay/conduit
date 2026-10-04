package media.conduit.mobile.foundation

import androidx.compose.runtime.Composable

data class ProfileFile(val name: String, val bytes: ByteArray)

interface ProfileFiles {
    val canImport: Boolean
    val canExport: Boolean
    /** Null/false means the system picker was cancelled. */
    suspend fun pick(): ProfileFile?
    suspend fun save(name: String, contents: String): Boolean
}

@Composable
expect fun rememberProfileFiles(): ProfileFiles
