package media.conduit.mobile.foundation

import java.io.ByteArrayOutputStream
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import media.conduit.mobile.account.MAX_PROFILE_IMPORT_BYTES

@Composable
actual fun rememberProfileFiles(): ProfileFiles {
    val context = LocalContext.current
    val importResult = remember { PendingDocument() }
    val exportResult = remember { PendingDocument() }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { importResult.complete(it) }
    val create = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { exportResult.complete(it) }
    DisposableEffect(Unit) {
        onDispose { importResult.cancel(); exportResult.cancel() }
    }
    return remember(context, open, create) {
        fun available(action: String): Boolean {
            val intent = Intent(action).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
            val activity = context.packageManager.resolveActivity(intent, 0)?.activityInfo ?: return false
            // The stock TV image advertises a picker stub which only exits without selecting a file.
            return !activity.packageName.contains("frameworkpackagestubs")
        }
        object : ProfileFiles {
            override val canImport = available(Intent.ACTION_OPEN_DOCUMENT)
            override val canExport = available(Intent.ACTION_CREATE_DOCUMENT)
            override suspend fun pick(): ProfileFile? {
                val uri = importResult.await { open.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) } ?: return null
                return withContext(Dispatchers.IO) {
                    val resolver = context.contentResolver
                    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    } ?: "profile.json"
                    val bytes = requireNotNull(resolver.openInputStream(uri)) { "Unable to open file" }.use {
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = it.read(buffer, 0, minOf(buffer.size, MAX_PROFILE_IMPORT_BYTES + 1 - output.size()))
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            require(output.size() <= MAX_PROFILE_IMPORT_BYTES) { "Import exceeds the 10 MiB limit" }
                        }
                        output.toByteArray()
                    }
                    ProfileFile(name, bytes)
                }
            }
            override suspend fun save(name: String, contents: String): Boolean {
                val uri = exportResult.await { create.launch(name) } ?: return false
                withContext(Dispatchers.IO) {
                    requireNotNull(context.contentResolver.openOutputStream(uri, "wt")) { "Unable to save file" }.use {
                        it.write(contents.toByteArray(Charsets.UTF_8))
                    }
                }
                return true
            }
        }
    }
}

private class PendingDocument {
    private var pending: CompletableDeferred<Uri?>? = null
    fun complete(uri: Uri?) { pending?.complete(uri) }
    fun cancel() { pending?.cancel() }
    suspend fun await(launch: () -> Unit): Uri? {
        check(pending == null) { "A file picker is already open" }
        val result = CompletableDeferred<Uri?>()
        pending = result
        return try { launch(); result.await() } finally { pending = null }
    }
}
