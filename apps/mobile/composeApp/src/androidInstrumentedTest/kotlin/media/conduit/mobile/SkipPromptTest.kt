package media.conduit.mobile

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SkipPromptTest {
    @get:Rule
    val compose = createComposeRule()

    private val intro = SkipSegment(10_000, 90_000, SkipSegmentType.Intro)
    private var segment by mutableStateOf<SkipSegment?>(intro)
    private var videoId by mutableStateOf("episode-1")
    private var controlsVisible by mutableStateOf(false)
    private var eligible by mutableStateOf(true)
    private lateinit var prompt: SkipPromptState

    private fun showPrompt() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            val currentSegment = segment
            prompt = rememberSkipPromptState("tt123", videoId, currentSegment, controlsVisible, eligible)
            Column {
                Button(onClick = { controlsVisible = !controlsVisible }) { Text("Toggle controls") }
                if (currentSegment != null && prompt.isVisible(controlsVisible, eligible)) {
                    Text(skipSegmentLabel(currentSegment.type))
                }
            }
        }
        settle()
    }

    private fun settle() {
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
    }

    private fun toggleControls() {
        compose.onNodeWithText("Toggle controls").performClick()
        settle()
    }

    @Test
    fun openingControlsPausesAndClosingResumesOnlyTheRemainingBudget() {
        showPrompt()
        compose.mainClock.advanceTimeBy(4_000)
        toggleControls()
        val remaining = compose.runOnIdle { prompt.progress.value }
        assertEquals(0.6f, remaining, 0.01f)

        compose.mainClock.advanceTimeBy(20_000)
        compose.runOnIdle { assertEquals(remaining, prompt.progress.value, 0f) }
        compose.onNodeWithText("Skip intro").assertExists()

        toggleControls()
        compose.mainClock.advanceTimeBy(5_000)
        compose.onNodeWithText("Skip intro").assertExists()
        compose.mainClock.advanceTimeBy(1_100)
        compose.onNodeWithText("Skip intro").assertDoesNotExist()

        toggleControls()
        compose.onNodeWithText("Skip intro").assertExists()
        toggleControls()
        compose.onNodeWithText("Skip intro").assertDoesNotExist()
    }

    @Test
    fun segmentEnteredWithControlsOpenGetsItsBudgetWhenControlsClose() {
        controlsVisible = true
        showPrompt()
        compose.mainClock.advanceTimeBy(20_000)
        compose.runOnIdle { assertEquals(1f, prompt.progress.value, 0f) }

        toggleControls()
        compose.mainClock.advanceTimeBy(9_000)
        compose.onNodeWithText("Skip intro").assertExists()
        compose.mainClock.advanceTimeBy(1_100)
        compose.onNodeWithText("Skip intro").assertDoesNotExist()
    }

    @Test
    fun presentationAndOverlaysSuspendTheBudgetWithoutResettingTheVisit() {
        showPrompt()
        compose.mainClock.advanceTimeBy(4_000)
        val before = compose.runOnIdle { prompt }
        compose.runOnIdle { eligible = false }
        settle()
        val remaining = compose.runOnIdle { prompt.progress.value }
        compose.onNodeWithText("Skip intro").assertDoesNotExist()
        compose.mainClock.advanceTimeBy(20_000)
        compose.runOnIdle {
            assertSame(before, prompt)
            assertEquals(remaining, prompt.progress.value, 0f)
            eligible = true
        }
        settle()
        compose.mainClock.advanceTimeBy(5_000)
        compose.onNodeWithText("Skip intro").assertExists()
        compose.mainClock.advanceTimeBy(1_100)
        compose.onNodeWithText("Skip intro").assertDoesNotExist()
    }

    @Test
    fun seekingOutAndBackOrChangingEpisodesStartsAFreshVisit() {
        showPrompt()
        compose.mainClock.advanceTimeBy(10_100)
        compose.onNodeWithText("Skip intro").assertDoesNotExist()
        val expired = compose.runOnIdle { prompt }

        // Equal segment data from a playback update or source replacement preserves the visit.
        compose.runOnIdle { segment = intro.copy() }
        settle()
        compose.runOnIdle { assertSame(expired, prompt) }

        compose.runOnIdle { segment = null }
        settle()
        compose.onNodeWithText("Skip intro").assertDoesNotExist()
        compose.runOnIdle { segment = intro }
        settle()
        compose.onNodeWithText("Skip intro").assertExists()
        compose.runOnIdle { assertNotSame(expired, prompt) }

        compose.mainClock.advanceTimeBy(4_000)
        compose.runOnIdle { segment = SkipSegment(90_000, 120_000, SkipSegmentType.Outro) }
        settle()
        compose.runOnIdle { assertEquals(1f, prompt.progress.value, 0.01f) }
        compose.onNodeWithText("Skip outro").assertExists()

        compose.mainClock.advanceTimeBy(4_000)
        compose.runOnIdle { videoId = "episode-2" }
        settle()
        compose.runOnIdle { assertEquals(1f, prompt.progress.value, 0.01f) }
    }
}
