package media.conduit.mobile

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.AndroidSecureStore
import media.conduit.mobile.foundation.ServerEndpoint
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.io.File
import java.net.URLDecoder
import java.util.concurrent.Executors

/** Real search, details, and cast navigation against a local catalog, without a live account. */
@RunWith(AndroidJUnit4::class)
class MetadataBrowseTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test
    fun castLinkReplacesAnExistingSearchWithActorResults() {
        val server = ServerSocket(0)
        val workers = Executors.newCachedThreadPool()
        val endpoint = ServerEndpoint("http://127.0.0.1:${server.localPort}", "Actor search fixture")
        val addon = InstalledAddonSummary("fixture", "fixture", "${endpoint.baseUrl}/manifest.json",
            Json.parseToJsonElement("""{"id":"fixture","name":"Fixture","version":"1.0.0","resources":["catalog","meta"],"types":["series"],"catalogs":[{"id":"shows","type":"series","name":"Shows","extra":[{"name":"search"}]},{"id":"more","type":"series","name":"More","extra":[{"name":"search"}]},{"id":"last","type":"series","name":"Last","extra":[{"name":"search"}]}]}""").jsonObject,
            position = 0, enabled = true)
        val bootstrap = BootstrapResponse(listOf(HouseholdSummary("household", "Home", "owner",
            listOf(ProfileSummary("profile", "Viewer", false)))), AccountUser("fixture@example.test"))
        workers.submit {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                workers.submit {
                    socket.use {
                        val path = URLDecoder.decode(it.getInputStream().bufferedReader().readLine().orEmpty().split(" ").getOrNull(1).orEmpty(), "UTF-8")
                        val body = when {
                            path.startsWith("/catalog/") -> {
                                val actor = path.contains("Example Actor")
                                val last = path.contains("/last/")
                                val id = if (actor) "related" else if (last) "original" else "earlier"
                                val name = if (actor) "Actor's other show" else if (last) "Original show" else "Earlier show"
                                if (actor && !last) """{"metas":[]}"""
                                else """{"metas":[{"id":"$id","type":"series","name":"$name"}]}"""
                            }
                            path.startsWith("/meta/") -> """{"meta":{"id":"original","type":"series","name":"Original show","cast":["Example Actor"],"videos":[{"id":"original:1:1","season":1,"episode":1,"title":"Pilot"}]}}"""
                            path == "/v1/bootstrap" -> Json.encodeToString(bootstrap)
                            path.endsWith("/addons") -> """{"addons":[${Json.encodeToString(addon)}]}"""
                            else -> """{"items":[]}"""
                        }
                        val bytes = body.toByteArray()
                        it.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        it.getOutputStream().write(bytes)
                    }
                }
            }
        }
        try {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            context.getSharedPreferences("conduit_device", 0).edit()
                .putString("server.endpoint.v1", Json.encodeToString(endpoint))
                .putString("account.active-profile.v1", "profile")
                .putString("mobile.rich-actions-hint.v1", "true")
                .commit()
            val secure = AndroidSecureStore(context.getSharedPreferences("conduit_secure_values", 0))
            val session = StoredSession(endpoint.baseUrl, "local-fixture-only", "2099-01-01T00:00:00Z")
            SessionVault(secure).apply { save(session); saveBootstrap(session, bootstrap) }
            ProfileSyncRepository(ConduitApi(), secure, profileCacheScope(endpoint.baseUrl, "fixture@example.test"))
                .save(ProfileSnapshot("profile", listOf(addon), emptyList(), emptyList(), emptyList(), emptyList()))
            ActivityScenario.launch(MainActivity::class.java).use {
                compose.waitUntil(15_000) { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
                compose.onNode(hasSetTextAction()).performTextReplacement("Original show")
                waitForText("Shows · Series · Fixture")
                compose.onNode(hasScrollToIndexAction() and hasAnyDescendant(hasText("Shows · Series · Fixture")))
                    .performScrollToIndex(4)
                compose.waitUntil(15_000) { compose.onAllNodes(hasContentDescription("Original show")).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithContentDescription("Original show").performClick()
                waitForText("Example Actor")
                compose.onNodeWithText("Example Actor").performClick()
                waitForText("Actor's other show")
                compose.onNodeWithText("Actor's other show").assertIsDisplayed()
                compose.onNodeWithText("Example Actor").assertIsDisplayed()
                compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
                    File(context.getExternalFilesDir(null), "actor-search.png").outputStream().use { output ->
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
                    }
                    bitmap.recycle()
                }
            }
        } finally {
            server.close()
            workers.shutdownNow()
        }
    }

    private fun waitForText(text: String) {
        compose.waitUntil(15_000) { compose.onAllNodes(hasText(text, substring = false)).fetchSemanticsNodes().isNotEmpty() }
    }
}
