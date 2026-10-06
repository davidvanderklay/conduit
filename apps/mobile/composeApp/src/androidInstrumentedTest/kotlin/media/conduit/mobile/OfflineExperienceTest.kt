package media.conduit.mobile

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.mobile.account.*
import media.conduit.mobile.foundation.AndroidSecureStore
import media.conduit.mobile.foundation.ServerEndpoint
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Exercises the real account gate and encrypted platform stores without a live server. */
@OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class OfflineExperienceTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test
    fun coldLaunchShowsCachedLibraryAndHistoryWithRetry() {
        seedAccount()
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(15_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("Offline")).fetchSemanticsNodes().isNotEmpty() }
            compose.onAllNodes(androidx.compose.ui.test.hasText("Library"), useUnmergedTree = true)[0].assertIsDisplayed()
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
            compose.waitUntil(15_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("Offline")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Offline").assertIsDisplayed()
        }
    }

    private fun seedAccount() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val endpoint = ServerEndpoint("http://127.0.0.1:18745", "Local hardening fixture")
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
        ProfileSyncRepository(ConduitApi(), secure, scope).save(ProfileSnapshot("issue45-profile", emptyList(), library, history, history, history))
        secure.put("profile.snapshot.time.v1.${scope.length}:$scope.issue45-profile", "2026-10-05T15:42:00Z")
    }

}
