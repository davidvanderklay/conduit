package media.conduit.mobile

import android.view.WindowManager
import android.view.Surface
import android.app.UiAutomation
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.filters.SdkSuppress
import media.conduit.mobile.account.ConduitApi
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.After
import org.junit.Rule
import org.junit.Test
import java.io.File

// Enable a display-cutout emulator overlay before running; ordinary devices skip this check.
@SdkSuppress(minSdkVersion = 30)
class WatchPartySafeAreaTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @After
    fun restoreRotation() {
        InstrumentationRegistry.getInstrumentation().uiAutomation.setRotation(UiAutomation.ROTATION_UNFREEZE)
    }

    @Test
    fun rightCutout() = checkLandscape(Surface.ROTATION_270)

    @Test
    fun leftCutout() = checkLandscape(Surface.ROTATION_90)

    private fun checkLandscape(rotation: Int) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.setRotation(rotation)
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.activity.window.decorView.width > compose.activity.window.decorView.height
        }
        compose.activityRule.scenario.onActivity { activity ->
            WindowCompat.setDecorFitsSystemWindows(activity.window, false)
            activity.window.attributes = activity.window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
            WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                .hide(WindowInsetsCompat.Type.systemBars())
        }
        compose.setContent {
            val scope = rememberCoroutineScope()
            val api = remember { ConduitApi() }
            val playback = remember { PlaybackSessionController(scope) }
            val controller = remember {
                WatchPartySessionController(scope, api, "http://127.0.0.1:1", "fixture", "fixture", playback)
                    .apply { sheetOpen = true }
            }
            DisposableEffect(Unit) {
                onDispose { controller.close(); api.close(); playback.close(saveProgress = false) }
            }
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color(0xFF142226))) {
                    WatchPartySheet(controller, api, "fixture", inPlayer = true)
                }
            }
        }
        compose.waitForIdle()
        compose.waitUntil(timeoutMillis = 5_000) {
            !compose.activity.window.decorView.rootWindowInsets.isVisible(android.view.WindowInsets.Type.statusBars())
        }
        // Optional screenshots exercise the real sheet without accounts, media, or a server.
        if (InstrumentationRegistry.getArguments().getString("captureScreenshot") == "true") instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
            val destination = File(compose.activity.getExternalFilesDir(null), "watch-party-safe-area-$rotation.png")
            destination.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
        }
        val bounds = compose.onNodeWithContentDescription("Close watch party").fetchSemanticsNode().boundsInWindow
        val root = compose.activity.window.decorView
        val cutout = root.rootWindowInsets.displayCutout
        assumeTrue("Requires landscape with a display cutout", root.width > root.height && cutout != null && (cutout.safeInsetRight > 0 || cutout.safeInsetLeft > 0))
        val safeRight = root.width - cutout!!.safeInsetRight
        assertTrue("Close button $bounds overlaps the right display cutout ${cutout.safeInsetRight}", bounds.right <= safeRight)
        val household = compose.onNodeWithText("Household").fetchSemanticsNode().boundsInWindow
        assertTrue("Party options overlap the cutout", household.left >= cutout.safeInsetLeft && household.right <= safeRight)
        val invite = compose.onNodeWithText("Paste invite link").fetchSemanticsNode().boundsInWindow
        assertTrue("Invite input overlaps the cutout", invite.left >= cutout.safeInsetLeft && invite.right <= safeRight)
    }
}
