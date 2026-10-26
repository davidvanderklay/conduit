package media.conduit.mobile.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import media.conduit.mobile.ProtocolJson
import media.conduit.mobile.coreValue

/** A profile's saved choice for one home catalog row. List order is display order. */
@Serializable
data class HomeRowSetting(
    val key: String,
    val enabled: Boolean,
    val title: String? = null,
)

/** A catalog an enabled add-on can show on Home. */
@Serializable
private data class HomeCatalogSource(
    /** Stable across reinstalls and imports, unlike the installation id. */
    val key: String,
    val title: String,
    val addonId: String,
    val addonName: String,
    val manifestUrl: String,
    val type: String,
    val catalogId: String,
)

/** A home catalog with the profile's saved order, title, and visibility applied. */
@Serializable
data class HomeRow(
    val key: String,
    val title: String,
    val defaultTitle: String,
    val enabled: Boolean,
    val addonId: String,
    val addonName: String,
    val manifestUrl: String,
    val type: String,
    val catalogId: String,
)

/** Home catalogs in add-on order. A second install of the same add-on repeats the first one's rows, so it is skipped. */
private fun homeCatalogSources(addons: List<InstalledAddonSummary>): List<HomeCatalogSource> = addons
    .filter { it.enabled }
    .flatMap { addon ->
        val addonName = addon.manifest["name"]?.jsonPrimitive?.contentOrNull ?: addon.manifestId
        addon.manifest["catalogs"]?.jsonArray.orEmpty()
            .mapNotNull { it as? JsonObject }
            .filter { catalog ->
                catalog["extra"]?.jsonArray.orEmpty().none { extra ->
                    (extra as? JsonObject)?.get("isRequired")?.jsonPrimitive?.booleanOrNull == true
                }
            }
            .mapNotNull { catalog ->
                val id = catalog["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val type = catalog["type"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                HomeCatalogSource(
                    key = "${addon.manifestId}:$type:$id",
                    title = formatCatalogTitle(catalog["name"]?.jsonPrimitive?.contentOrNull ?: "$addonName · $id", type),
                    addonId = addon.id,
                    addonName = addonName,
                    manifestUrl = addon.manifestUrl,
                    type = type,
                    catalogId = id,
                )
            }
    }
    .distinctBy { it.key }

/** Every home catalog with the profile's saved order, titles, and visibility applied. */
fun arrangeHomeRows(addons: List<InstalledAddonSummary>, settings: List<HomeRowSetting> = emptyList()): List<HomeRow> =
    ProtocolJson.decodeFromJsonElement(
        coreValue(buildJsonObject {
            put("type", "arrangeHomeRows")
            put("catalogs", ProtocolJson.encodeToJsonElement(homeCatalogSources(addons)))
            put("settings", ProtocolJson.encodeToJsonElement(settings))
        }),
    )

/** Settings to save for edited rows. Choices for catalogs that are unavailable right now, such as a disabled add-on's, are kept. */
fun homeRowSettings(rows: List<HomeRow>, previous: List<HomeRowSetting>): List<HomeRowSetting> {
    val keys = rows.mapTo(mutableSetOf(), HomeRow::key)
    return rows.map { row ->
        HomeRowSetting(row.key, row.enabled, row.title.trim().takeIf { it.isNotEmpty() && it != row.defaultTitle })
    } + previous.filter { it.key !in keys }
}
