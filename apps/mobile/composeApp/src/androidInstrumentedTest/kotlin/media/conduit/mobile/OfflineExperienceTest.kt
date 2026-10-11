package media.conduit.mobile

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.AndroidSecureStore
import media.conduit.mobile.foundation.ServerEndpoint
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Exercises the real account gate and encrypted platform stores without external services. */
@OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class OfflineExperienceTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test
    fun cachedLaunchShowsLoadingBeforeCatalogsFinish() {
        val server = ServerSocket(0)
        val workers = Executors.newCachedThreadPool()
        val catalogRequested = CountDownLatch(1)
        val release = CountDownLatch(1)
        workers.submit {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                workers.submit {
                    socket.use {
                        val path = it.getInputStream().bufferedReader().readLine().orEmpty().split(" ").getOrNull(1).orEmpty()
                        val catalog = path.startsWith("/catalog/")
                        if (catalog) catalogRequested.countDown()
                        release.await(30, TimeUnit.SECONDS)
                        val body = if (catalog) """{"metas":[]}""" else "{}"
                        val status = if (catalog) "200 OK" else "503 Service Unavailable"
                        it.getOutputStream().write("HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body".toByteArray())
                    }
                }
            }
        }
        try {
            val endpoint = ServerEndpoint("http://127.0.0.1:${server.localPort}", "Startup fixture")
            val addon = InstalledAddonSummary("fixture", "fixture", "${endpoint.baseUrl}/manifest.json",
                Json.parseToJsonElement("""{"name":"Fixture","catalogs":[{"id":"test","type":"movie"}]}""").jsonObject,
                position = 0, enabled = true)
            seedAccount(endpoint, listOf(addon))
            ActivityScenario.launch(MainActivity::class.java).use {
                assertTrue("Home catalog request started", catalogRequested.await(15, TimeUnit.SECONDS))
                compose.onNodeWithText("LOADING YOUR HOME").assertIsDisplayed()
                release.countDown()
                compose.waitUntil(15_000) {
                    compose.onAllNodes(androidx.compose.ui.test.hasText("LOADING YOUR HOME")).fetchSemanticsNodes().isEmpty()
                }
                compose.onNodeWithText("Home").assertIsSelected()
            }
        } finally {
            release.countDown()
            server.close()
            workers.shutdownNow()
        }
    }

    @Test
    fun coldLaunchStartsOnHomeAndKeepsCachedLibraryAndHistoryAccessible() {
        seedAccount()
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(15_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("Offline · showing saved activity")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Home").assertIsSelected()
            compose.onNodeWithText("Library").performClick()
            compose.onNodeWithText("Offline").assertIsDisplayed()
            compose.waitUntil(20_000) {
                compose.onAllNodes(androidx.compose.ui.test.hasText("Retry")).fetchSemanticsNodes().any { it.boundsInRoot.width > 0 && it.boundsInRoot.height > 0 }
            }
            compose.onNodeWithText("Retry").assertIsDisplayed()
            compose.onNodeWithContentDescription("Open watch history").performClick()
            compose.onNodeWithText("Watch history").assertIsDisplayed()
            compose.onNodeWithText("Offline").assertIsDisplayed()
            compose.onNodeWithText("Retry").performClick()
            compose.waitUntil(15_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("Retry")).fetchSemanticsNodes().isNotEmpty() }
            it.recreate()
            compose.waitUntil(15_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("Offline · showing saved activity")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Home").assertIsSelected()
            compose.onNodeWithText("Offline · showing saved activity").assertIsDisplayed()
        }
    }

    private fun seedAccount(
        endpoint: ServerEndpoint = ServerEndpoint("http://127.0.0.1:18745", "Local hardening fixture"),
        addons: List<InstalledAddonSummary> = emptyList(),
    ) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("conduit_device", 0).edit()
            .putString("server.endpoint.v1", Json.encodeToString(endpoint))
            .putString("account.active-profile.v1", "issue45-profile")
            .putString("preferences.v1.amoled", "true")
            .putString("mobile.rich-actions-hint.v1", "true")
            .commit()
        val secure = AndroidSecureStore(context.getSharedPreferences("conduit_secure_values", 0))
        val session = StoredSession(endpoint.baseUrl, "local-fixture-only", "2099-01-01T00:00:00Z")
        val bootstrap = BootstrapResponse(listOf(HouseholdSummary("issue45-household", "Home", "owner",
            listOf(ProfileSummary("issue45-profile", "David", false)))), AccountUser("fixture@example.test"))
        SessionVault(secure).apply { save(session); saveBootstrap(session, bootstrap) }
        val titles = listOf("Arrival", "Severance", "Dune", "Interstellar", "The Bear", "Past Lives")
        val library = titles.mapIndexed { index, title ->
            val bitmap = Bitmap.createBitmap(300, 450, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            canvas.drawColor(listOf(0xff293342.toInt(), 0xff182b24.toInt(), 0xff584532.toInt())[index % 3])
            paint.color = 0xff809390.toInt()
            canvas.drawCircle(150f, 175f, 80f, paint)
            paint.color = Color.WHITE
            paint.textSize = 25f
            paint.textAlign = Paint.Align.CENTER
            canvas.drawText(title, 150f, 355f, paint)
            val image = File(context.cacheDir, "issue45-$index.png")
            image.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
            LibraryItemSummary("fixture:$index", if (index in listOf(1, 4)) "series" else "movie", title,
                poster = image.toURI().toString(), updatedAt = "2026-10-05T15:42:00Z")
        }
        val history = library.take(3).mapIndexed { index, item ->
            ProgressSummary(item.id, item.type, item.id, item.name, poster = item.poster,
                positionMs = 2_280_000, durationMs = 6_000_000, watched = false,
                updatedAt = "2026-10-05T15:4${index}:00Z", continueWatching = true,
                season = if (item.type == "series") 2 else null, episode = if (item.type == "series") 3 else null)
        }
        val scope = profileCacheScope(endpoint.baseUrl, "fixture@example.test")
        ProfileSyncRepository(ConduitApi(), secure, scope).save(ProfileSnapshot("issue45-profile", addons, library, history, history, history))
        secure.put("profile.snapshot.time.v1.${scope.length}:$scope.issue45-profile", "2026-10-05T15:42:00Z")
    }

}
