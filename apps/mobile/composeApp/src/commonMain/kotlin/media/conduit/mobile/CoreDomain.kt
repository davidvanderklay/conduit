package media.conduit.mobile

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Calls a synchronous, stateless conduit-core operation through the platform bridge. */
internal fun coreValue(action: JsonObject): JsonElement {
    val response = ProtocolJson.parseToJsonElement(evaluateCore(action.toString())).jsonObject
    if (response["ok"]?.jsonPrimitive?.boolean != true) {
        val error = response["error"]?.jsonObject
        val code = error?.get("code")?.jsonPrimitive?.content ?: "core_error"
        val message = error?.get("message")?.jsonPrimitive?.content ?: "Rust core operation failed"
        error("$code: $message")
    }
    return checkNotNull(response["value"]) { "Rust core returned no value" }
}
