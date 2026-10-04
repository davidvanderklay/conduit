package media.conduit.mobile

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isToggleable
import androidx.test.platform.app.InstrumentationRegistry
import android.content.res.Configuration
import org.junit.Assume.assumeTrue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import media.conduit.mobile.foundation.ConduitTheme
import media.conduit.mobile.foundation.DevicePreferencesRepository
import media.conduit.mobile.foundation.MemorySettingsStore
import media.conduit.mobile.foundation.PlatformInfo
import media.conduit.mobile.foundation.ResumeBehavior
import media.conduit.mobile.tv.playbackSettings
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class PlaybackPreferencesUiTest {
    @get:Rule val compose = createComposeRule()
    private val repository = DevicePreferencesRepository(MemorySettingsStore())
    private var preferences by mutableStateOf(repository.load())
    private val isTv = InstrumentationRegistry.getInstrumentation().targetContext.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION
    private val platform = PlatformInfo("Android", "test", "test")

    @Test
    fun mobileResumeChoicePersists() {
        compose.setContent {
            ConduitTheme(amoledBlack = true) {
                PlaybackSettingsScreen(platform, preferences, { preferences = repository.save(it) }, {}, Modifier)
            }
        }
        compose.onNodeWithText("Resume behavior").performClick()
        compose.onNodeWithText("Start over").performClick()
        compose.runOnIdle { assertEquals(ResumeBehavior.Restart, repository.load().resumeBehavior) }
        compose.onNodeWithText("Start over").assertExists()
    }

    @Test
    fun advancedTuningPersistsAndMedia3HidesTheMpvControl() {
        preferences = preferences.copy(androidPlaybackEngine = AndroidPlaybackEngine.Libmpv)
        compose.setContent {
            ConduitTheme(amoledBlack = true) {
                AdvancedSettingsScreen(platform, preferences, { preferences = repository.save(it) }, {}, {}, Modifier)
            }
        }
        compose.onAllNodes(isToggleable())[0].performClick()
        compose.runOnIdle { assertEquals(false, repository.load().hardwareDecoding) }
        compose.onNodeWithText("Network read-ahead").performClick()
        compose.onNodeWithText("Custom").performClick()
        compose.onNodeWithText("30 seconds").assertExists()
        compose.onNodeWithText("Save").performClick()
        compose.runOnIdle { assertEquals(30, repository.load().readAheadSeconds) }
        compose.onNodeWithText("Network read-ahead").performClick()
        compose.onNodeWithText("Automatic").performClick()
        compose.onNodeWithText("Save").performClick()
        compose.runOnIdle {
            assertEquals(null, repository.load().readAheadSeconds)
            preferences = preferences.copy(androidPlaybackEngine = AndroidPlaybackEngine.Media3)
        }
        compose.onNodeWithText("Hardware decoding").assertDoesNotExist()
    }

    @Test
    fun tvChoicesSupportRemoteSelectionAndPersist() {
        assumeTrue(isTv)
        compose.setContent {
            ConduitTheme(amoledBlack = true) {
                LazyColumn { playbackSettings(preferences) { preferences = repository.save(it) } }
            }
        }
        compose.onNodeWithText("Resume behavior").performScrollTo().performClick()
        compose.onNode(hasText("Ask every time") and hasAnyAncestor(isDialog())).performKeyInput {
            keyDown(Key.DirectionDown); keyUp(Key.DirectionDown)
            keyDown(Key.DirectionCenter); keyUp(Key.DirectionCenter)
        }
        compose.runOnIdle { assertEquals(ResumeBehavior.Always, repository.load().resumeBehavior) }
        compose.onNodeWithText("Network read-ahead").performScrollTo().performClick()
        compose.onNodeWithText("30 seconds").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(30, repository.load().readAheadSeconds) }
    }

    @Test
    fun resumePromptFocusAndActionsDoNotRequireTouch() {
        var chosen: Long? = null
        compose.setContent {
            ConduitTheme(amoledBlack = true) {
                PlaybackResumeDialog(42_000, { chosen = 42_000 }, { chosen = 0 }, { chosen = null })
            }
        }
        if (isTv) {
            compose.onNodeWithText("Resume").assertIsFocused()
            compose.onNodeWithText("Resume").performKeyInput {
                keyDown(Key.DirectionCenter); keyUp(Key.DirectionCenter)
            }
        } else {
            compose.onNodeWithText("Resume").performClick()
        }
        compose.runOnIdle { assertEquals(42_000L, chosen) }
        compose.onNodeWithText("Start over").performClick()
        compose.runOnIdle { assertEquals(0L, chosen) }
        compose.onNodeWithText("Cancel").performClick()
        compose.runOnIdle { assertEquals(null, chosen) }
    }
}
