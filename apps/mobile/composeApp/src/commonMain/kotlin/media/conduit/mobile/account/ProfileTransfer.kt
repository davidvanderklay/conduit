package media.conduit.mobile.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

const val MAX_PROFILE_IMPORT_BYTES = 10 * 1024 * 1024

@Serializable
data class ProfileImportPreview(
    val version: Int,
    val profile: ImportedProfile,
    val counts: ImportCounts,
    val importableAddons: Int,
    val warnings: List<String>,
)

@Serializable
data class ImportedProfile(val name: String, val isKids: Boolean)

@Serializable
data class ImportCounts(val library: Int, val progress: Int, val addons: Int)

enum class ProfileImportMode(val value: String) { Merge("merge"), Replace("replace") }

/** Keep the archive intact, including optional fields from other clients. The server validates its contents. */
fun parseProfileArchive(bytes: ByteArray): JsonObject {
    require(bytes.size <= MAX_PROFILE_IMPORT_BYTES) { "Import exceeds the 10 MiB limit" }
    val text = bytes.decodeToString(throwOnInvalidSequence = true)
    return Json.parseToJsonElement(text) as? JsonObject
        ?: throw IllegalArgumentException("Import must be a JSON object")
}
