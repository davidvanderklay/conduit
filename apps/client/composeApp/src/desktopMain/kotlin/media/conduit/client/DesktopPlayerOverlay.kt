package media.conduit.client

import java.awt.AlphaComposite
import java.awt.BasicStroke
import java.awt.Canvas
import java.awt.Color
import java.awt.Component
import java.awt.Font
import java.awt.GradientPaint
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Window
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import java.awt.geom.Path2D
import kotlin.math.roundToInt
import java.util.concurrent.atomic.AtomicReference
import javax.swing.SwingUtilities

internal data class DesktopPlayerOverlayState(
    val playing: Boolean = false,
    val buffering: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val volume: Float = 100f,
    val muted: Boolean = false,
)

internal data class DesktopPlayerOverlayActions(
    val onTogglePlayback: () -> Unit = {},
    val onSeekTo: (Long) -> Unit = {},
    val onNextEpisode: () -> Unit = {},
    val onEpisodes: () -> Unit = {},
    val onSources: () -> Unit = {},
    val onCycleSubtitle: () -> Unit = {},
    val onCycleAudio: () -> Unit = {},
    val onSetVolume: (Float) -> Unit = {},
    val onToggleMute: () -> Unit = {},
    val onBack: () -> Unit = {},
    val onControlsVisibilityChanged: (Boolean) -> Unit = {},
)

internal enum class DesktopPlayerOverlayTarget {
    Seek,
    TogglePlayback,
    NextEpisode,
    ToggleMute,
    SetVolume,
    Subtitles,
    Audio,
    Episodes,
    Sources,
    Back,
    HideControls,
    None,
}

private data class DesktopPlayerOverlayActionBounds(
    val target: DesktopPlayerOverlayTarget,
    val label: String?,
    val left: Int,
    val right: Int,
)

/**
 * Keeps hit testing in the same coordinate system as the painted HUD. This is
 * deliberately separate from AWT so scaling regressions can be tested without
 * starting a desktop window.
 */
internal data class DesktopPlayerOverlayGeometry(
    val scale: Float,
    val progressY: Int,
    val progressLeft: Int,
    val progressRight: Int,
    val actionY: Int,
    val playbackLeft: Int,
    val playbackRight: Int,
    val nextLeft: Int,
    val nextRight: Int,
    val muteLeft: Int,
    val muteRight: Int,
    val volumeLeft: Int,
    val volumeRight: Int,
)

internal fun desktopPlayerOverlayGeometry(
    width: Int,
    height: Int,
    hasNextEpisode: Boolean,
): DesktopPlayerOverlayGeometry {
    val scale = (width / 1280f).coerceIn(.8f, 1.4f)
    val side = (24 * scale).roundToInt()
    val progressY = height - (91 * scale).roundToInt()
    val actionY = height - (43 * scale).roundToInt()
    val playbackLeft = side - (12 * scale).roundToInt()
    val playbackRight = playbackLeft + (54 * scale).roundToInt()
    val nextLeft = playbackRight + (4 * scale).roundToInt()
    val nextRight = nextLeft + (48 * scale).roundToInt()
    val volumeAnchor = if (hasNextEpisode) nextRight else playbackRight
    val muteLeft = volumeAnchor + (4 * scale).roundToInt()
    val muteRight = muteLeft + (32 * scale).roundToInt()
    val volumeLeft = muteRight + (8 * scale).roundToInt()
    val volumeRight = volumeLeft + (100 * scale).roundToInt()
    return DesktopPlayerOverlayGeometry(
        scale = scale,
        progressY = progressY,
        progressLeft = side,
        progressRight = width - side,
        actionY = actionY,
        playbackLeft = playbackLeft,
        playbackRight = playbackRight,
        nextLeft = nextLeft,
        nextRight = nextRight,
        muteLeft = muteLeft,
        muteRight = muteRight,
        volumeLeft = volumeLeft,
        volumeRight = volumeRight,
    )
}

internal fun desktopPlayerOverlaySeekFraction(width: Int, height: Int, x: Int): Float {
    val layout = desktopPlayerOverlayGeometry(width, height, hasNextEpisode = false)
    return ((x - layout.progressLeft).toFloat() / (layout.progressRight - layout.progressLeft).toFloat())
        .coerceIn(0f, 1f)
}

internal fun desktopPlayerOverlayVolumeFraction(width: Int, height: Int, hasNextEpisode: Boolean, x: Int): Float {
    val layout = desktopPlayerOverlayGeometry(width, height, hasNextEpisode)
    return ((x - layout.volumeLeft).toFloat() / (layout.volumeRight - layout.volumeLeft).toFloat())
        .coerceIn(0f, 1f)
}

/**
 * Owns the Linux desktop HUD in a transparent, owned AWT window. The mpv video
 * output is an X11 child of the SwingPanel, so a Compose layer cannot paint over
 * it reliably. An owned transparent window keeps the controls above that child
 * without enabling mpv's default OSC.
 */
internal class DesktopPlayerOverlay {
    private val state = AtomicReference(DesktopPlayerOverlayState())
    private val actions = AtomicReference(DesktopPlayerOverlayActions())
    private val canvas = OverlayCanvas()
    private var host: Component? = null
    private var window: Window? = null
    private var active = false
    private var controlsVisible = true
    private var title = "Conduit"
    private var metadata = "Direct Play"
    private var hasNextEpisode = false
    private var hasEpisodes = false
    private var hasSources = false

    fun attach(host: Component) {
        runOnEdt {
            if (this.host === host && window != null) {
                syncBoundsOnEdt()
                return@runOnEdt
            }
            disposeOnEdt()
            val owner = SwingUtilities.getWindowAncestor(host) ?: return@runOnEdt
            this.host = host
            window = Window(owner).apply {
                background = Color(0, 0, 0, 0)
                setFocusableWindowState(false)
                setAutoRequestFocus(false)
                layout = java.awt.BorderLayout()
                add(canvas, java.awt.BorderLayout.CENTER)
            }
            syncBoundsOnEdt()
            window?.isVisible = active
        }
    }

    fun setActive(active: Boolean) {
        this.active = active
        runOnEdt {
            syncBoundsOnEdt()
            window?.isVisible = active && host?.isDisplayable == true
            if (active) window?.toFront()
        }
    }

    fun setControlsVisible(visible: Boolean) {
        controlsVisible = visible
        canvas.repaint()
    }

    fun updateState(next: DesktopPlayerOverlayState) {
        state.set(next)
        canvas.repaint()
    }

    fun updateContent(
        title: String?,
        metadata: String,
        hasNextEpisode: Boolean,
        hasEpisodes: Boolean,
        hasSources: Boolean,
    ) {
        this.title = title?.takeIf(String::isNotBlank) ?: "Conduit"
        this.metadata = metadata
        this.hasNextEpisode = hasNextEpisode
        this.hasEpisodes = hasEpisodes
        this.hasSources = hasSources
        canvas.repaint()
    }

    fun updateActions(actions: DesktopPlayerOverlayActions) {
        this.actions.set(actions)
    }

    fun syncBounds() = runOnEdt(::syncBoundsOnEdt)

    fun dispose() = runOnEdt(::disposeOnEdt)

    private fun syncBoundsOnEdt() {
        val target = host ?: return
        val overlay = window ?: return
        if (!target.isDisplayable || target.width <= 1 || target.height <= 1) return
        val location = runCatching { target.locationOnScreen }.getOrNull() ?: return
        overlay.setBounds(location.x, location.y, target.width, target.height)
    }

    private fun disposeOnEdt() {
        window?.isVisible = false
        window?.dispose()
        window = null
        host = null
    }

    private fun runOnEdt(action: () -> Unit) {
        if (SwingUtilities.isEventDispatchThread()) action()
        else SwingUtilities.invokeLater(action)
    }

    private inner class OverlayCanvas : Canvas() {
        private var seekDragging = false
        private var volumeDragging = false

        init {
            background = Color(0, 0, 0, 0)
            isFocusable = false
            addMouseListener(object : MouseAdapter() {
                override fun mousePressed(event: MouseEvent) {
                    if (!controlsVisible) {
                        actions.get().onControlsVisibilityChanged(true)
                        return
                    }
                    when (targetAt(event.x, event.y)) {
                        DesktopPlayerOverlayTarget.Back -> actions.get().onBack()
                        DesktopPlayerOverlayTarget.Seek -> {
                            seekDragging = true
                            seekAt(event.x)
                        }
                        DesktopPlayerOverlayTarget.TogglePlayback -> actions.get().onTogglePlayback()
                        DesktopPlayerOverlayTarget.NextEpisode -> actions.get().onNextEpisode()
                        DesktopPlayerOverlayTarget.ToggleMute -> actions.get().onToggleMute()
                        DesktopPlayerOverlayTarget.SetVolume -> {
                            volumeDragging = true
                            volumeAt(event.x)
                        }
                        DesktopPlayerOverlayTarget.Subtitles -> actions.get().onCycleSubtitle()
                        DesktopPlayerOverlayTarget.Audio -> actions.get().onCycleAudio()
                        DesktopPlayerOverlayTarget.Episodes -> actions.get().onEpisodes()
                        DesktopPlayerOverlayTarget.Sources -> actions.get().onSources()
                        DesktopPlayerOverlayTarget.HideControls -> actions.get().onControlsVisibilityChanged(false)
                        DesktopPlayerOverlayTarget.None -> Unit
                    }
                }

                override fun mouseReleased(event: MouseEvent) {
                    seekDragging = false
                    volumeDragging = false
                }
            })
            addMouseMotionListener(object : MouseMotionAdapter() {
                override fun mouseMoved(event: MouseEvent) {
                    if (!controlsVisible) actions.get().onControlsVisibilityChanged(true)
                }

                override fun mouseDragged(event: MouseEvent) {
                    when {
                        seekDragging -> seekAt(event.x)
                        volumeDragging -> volumeAt(event.x)
                    }
                }
            })
        }

        override fun update(graphics: Graphics) = paint(graphics)

        override fun paint(graphics: Graphics) {
            val g = graphics.create() as? Graphics2D ?: return
            try {
                g.composite = AlphaComposite.Clear
                g.fillRect(0, 0, width, height)
                if (!controlsVisible || width <= 1 || height <= 1) return
                g.composite = AlphaComposite.SrcOver
                val ui = state.get()
                val scale = (width / 1280f).coerceIn(.8f, 1.4f)
                drawGradients(g, scale)
                drawHeader(g, scale)
                drawProgress(g, ui, scale)
                drawActions(g, ui, scale)
            } finally {
                g.dispose()
            }
        }

        private fun geometry(): DesktopPlayerOverlayGeometry =
            desktopPlayerOverlayGeometry(width, height, hasNextEpisode)

        private fun targetAt(x: Int, y: Int): DesktopPlayerOverlayTarget {
            if (y < (84 * geometry().scale).roundToInt() && x < (84 * geometry().scale).roundToInt()) {
                return DesktopPlayerOverlayTarget.Back
            }
            val seek = geometry()
            if (y in (seek.progressY - (18 * seek.scale).roundToInt())..(seek.progressY + (18 * seek.scale).roundToInt())) {
                return DesktopPlayerOverlayTarget.Seek
            }
            if (y !in (seek.actionY - (30 * seek.scale).roundToInt())..(seek.actionY + (28 * seek.scale).roundToInt())) {
                return DesktopPlayerOverlayTarget.HideControls
            }
            if (x in seek.playbackLeft..seek.playbackRight) return DesktopPlayerOverlayTarget.TogglePlayback
            if (hasNextEpisode && x in seek.nextLeft..seek.nextRight) return DesktopPlayerOverlayTarget.NextEpisode
            if (x in seek.muteLeft..seek.muteRight) return DesktopPlayerOverlayTarget.ToggleMute
            if (x in seek.volumeLeft..seek.volumeRight) return DesktopPlayerOverlayTarget.SetVolume
            rightActionBounds().firstOrNull { x in it.left..it.right }?.let { return it.target }
            return DesktopPlayerOverlayTarget.HideControls
        }

        private fun drawGradients(g: Graphics2D, scale: Float) {
            val topHeight = (150f * scale).toInt().coerceAtMost(height / 2)
            val bottomHeight = (220f * scale).toInt().coerceAtMost(height)
            g.paint = GradientPaint(0f, 0f, Color(0, 0, 0, 190), 0f, topHeight.toFloat(), Color(0, 0, 0, 0))
            g.fillRect(0, 0, width, topHeight)
            g.paint = GradientPaint(0f, (height - bottomHeight).toFloat(), Color(0, 0, 0, 0), 0f, height.toFloat(), Color(0, 0, 0, 220))
            g.fillRect(0, height - bottomHeight, width, bottomHeight)
        }

        private fun drawHeader(g: Graphics2D, scale: Float) {
            val left = (24 * scale).toInt()
            val top = (24 * scale).toInt()
            g.color = Color.WHITE
            g.stroke = BasicStroke((2.4f * scale).coerceAtLeast(1.5f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.drawLine(left + (18 * scale).toInt(), top + (10 * scale).toInt(), left + (28 * scale).toInt(), top)
            g.drawLine(left + (18 * scale).toInt(), top + (10 * scale).toInt(), left + (28 * scale).toInt(), top + (20 * scale).toInt())
            g.font = uiFont(Font.BOLD, 18, scale)
            g.drawString(title, left + (42 * scale).toInt(), top + (8 * scale).toInt())
            g.font = uiFont(Font.PLAIN, 12, scale)
            g.color = Color(255, 255, 255, 180)
            g.drawString(metadata, left + (42 * scale).toInt(), top + (29 * scale).toInt())
        }

        private fun drawProgress(g: Graphics2D, ui: DesktopPlayerOverlayState, scale: Float) {
            val layout = geometry()
            val left = layout.progressLeft
            val right = layout.progressRight
            val y = layout.progressY
            val progress = if (ui.durationMs > 0) {
                (ui.positionMs.toFloat() / ui.durationMs.toFloat()).coerceIn(0f, 1f)
            } else 0f
            g.stroke = BasicStroke((5f * scale).coerceAtLeast(3f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.color = Color(255, 255, 255, 150)
            g.drawLine(left, y, right, y)
            g.color = Color(250, 204, 21)
            val progressX = left + ((right - left) * progress).toInt()
            g.drawLine(left, y, progressX, y)
            g.fillOval(progressX - 7, y - 7, 14, 14)
            g.font = uiFont(Font.PLAIN, 13, scale)
            g.color = Color.WHITE
            g.drawString(formatDesktopTime(ui.positionMs), left, y - (13 * scale).toInt())
            val duration = formatDesktopTime(ui.durationMs)
            val durationWidth = g.fontMetrics.stringWidth(duration)
            g.drawString(duration, right - durationWidth, y - (13 * scale).toInt())
        }

        private fun drawActions(g: Graphics2D, ui: DesktopPlayerOverlayState, scale: Float) {
            val layout = geometry()
            val y = layout.actionY
            g.color = Color.WHITE
            val iconScale = scale.coerceAtLeast(.8f)
            if (ui.buffering) drawBufferingIcon(g, layout.playbackLeft + (27 * scale).toInt(), y, iconScale)
            else drawPlayPauseIcon(g, layout.playbackLeft + (27 * scale).toInt(), y, iconScale, ui.playing)
            if (hasNextEpisode) {
                drawNextIcon(g, layout.nextLeft + (24 * scale).toInt(), y, iconScale)
            }
            val volume = if (ui.muted) 0f else (ui.volume / 100f).coerceIn(0f, 1f)
            drawVolumeIcon(g, (layout.muteLeft + layout.muteRight) / 2, y, iconScale, volume > 0f)
            g.stroke = BasicStroke((3f * scale).coerceAtLeast(2f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.color = Color(255, 255, 255, 150)
            g.drawLine(layout.volumeLeft, y, layout.volumeRight, y)
            g.color = Color.WHITE
            val volumeX = layout.volumeLeft + ((layout.volumeRight - layout.volumeLeft) * volume).toInt()
            g.drawLine(layout.volumeLeft, y, volumeX, y)
            g.fillOval(volumeX - (5 * scale).toInt(), y - (5 * scale).toInt(), (10 * scale).toInt(), (10 * scale).toInt())

            rightActionBounds().forEach { action ->
                drawRightAction(g, action, y, scale)
            }
        }

        private fun drawRightAction(
            g: Graphics2D,
            action: DesktopPlayerOverlayActionBounds,
            y: Int,
            scale: Float,
        ) {
            g.font = uiFont(Font.PLAIN, 13, scale)
            g.color = Color.WHITE
            val iconX = action.left + (10 * scale).toInt()
            drawActionIcon(g, action.target, iconX, y, scale)
            action.label?.let { label ->
                g.drawString(label, action.left + (28 * scale).toInt(), y + (5 * scale).toInt())
            }
        }

        private fun rightActionBounds(): List<DesktopPlayerOverlayActionBounds> {
            val layout = geometry()
            val scale = layout.scale
            val font = uiFont(Font.PLAIN, 13, scale)
            val textMetrics = getFontMetrics(font)
            val specs = buildList {
                add(DesktopPlayerOverlayActionBounds(DesktopPlayerOverlayTarget.Subtitles, "Subtitles", 0, 0))
                add(DesktopPlayerOverlayActionBounds(DesktopPlayerOverlayTarget.Audio, "Audio", 0, 0))
                if (hasEpisodes) add(DesktopPlayerOverlayActionBounds(DesktopPlayerOverlayTarget.Episodes, "Episodes", 0, 0))
                if (hasSources) add(DesktopPlayerOverlayActionBounds(DesktopPlayerOverlayTarget.Sources, "Sources", 0, 0))
            }
            var right = width - (24 * scale).roundToInt()
            return specs.asReversed().map { spec ->
                val labelWidth = spec.label?.let(textMetrics::stringWidth) ?: 0
                val actionWidth = (18 * scale).roundToInt() + (10 * scale).roundToInt() + labelWidth
                val left = right - actionWidth
                val bounds = spec.copy(left = left - (10 * scale).roundToInt(), right = right + (8 * scale).roundToInt())
                right = left - (20 * scale).roundToInt()
                bounds
            }.asReversed()
        }

        private fun uiFont(style: Int, size: Int, scale: Float): Font =
            Font("Dialog", style, (size * scale).roundToInt().coerceAtLeast(11))

        private fun drawActionIcon(g: Graphics2D, target: DesktopPlayerOverlayTarget, x: Int, y: Int, scale: Float) {
            when (target) {
                DesktopPlayerOverlayTarget.Subtitles -> drawSubtitleIcon(g, x, y, scale)
                DesktopPlayerOverlayTarget.Audio -> drawAudioIcon(g, x, y, scale)
                DesktopPlayerOverlayTarget.Episodes -> drawEpisodesIcon(g, x, y, scale)
                DesktopPlayerOverlayTarget.Sources -> drawSourcesIcon(g, x, y, scale)
                DesktopPlayerOverlayTarget.Back -> drawFullscreenIcon(g, x, y, scale)
                else -> Unit
            }
        }

        private fun drawBufferingIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((2f * scale).coerceAtLeast(1.5f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.drawArc(x - (9 * scale).roundToInt(), y - (9 * scale).roundToInt(), (18 * scale).roundToInt(), (18 * scale).roundToInt(), 35, 270)
        }

        private fun drawPlayPauseIcon(g: Graphics2D, x: Int, y: Int, scale: Float, playing: Boolean) {
            if (playing) {
                val barWidth = (5 * scale).roundToInt().coerceAtLeast(4)
                val barHeight = (22 * scale).roundToInt().coerceAtLeast(16)
                g.fillRoundRect(x - (9 * scale).roundToInt(), y - barHeight / 2, barWidth, barHeight, barWidth, barWidth)
                g.fillRoundRect(x + (4 * scale).roundToInt(), y - barHeight / 2, barWidth, barHeight, barWidth, barWidth)
            } else {
                val play = Path2D.Float()
                play.moveTo((x - 8 * scale).toDouble(), (y - 13 * scale).toDouble())
                play.lineTo((x - 8 * scale).toDouble(), (y + 13 * scale).toDouble())
                play.lineTo((x + 13 * scale).toDouble(), y.toDouble())
                play.closePath()
                g.fill(play)
            }
        }

        private fun drawNextIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((2.2f * scale).coerceAtLeast(1.5f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            val first = Path2D.Float()
            first.moveTo((x - 14 * scale).toDouble(), (y - 11 * scale).toDouble())
            first.lineTo((x - 2 * scale).toDouble(), y.toDouble())
            first.lineTo((x - 14 * scale).toDouble(), (y + 11 * scale).toDouble())
            g.draw(first)
            val second = Path2D.Float()
            second.moveTo((x - 2 * scale).toDouble(), (y - 11 * scale).toDouble())
            second.lineTo((x + 10 * scale).toDouble(), y.toDouble())
            second.lineTo((x - 2 * scale).toDouble(), (y + 11 * scale).toDouble())
            g.draw(second)
            g.drawLine((x + 13 * scale).roundToInt(), (y - 11 * scale).roundToInt(), (x + 13 * scale).roundToInt(), (y + 11 * scale).roundToInt())
        }

        private fun drawVolumeIcon(g: Graphics2D, x: Int, y: Int, scale: Float, audible: Boolean) {
            g.stroke = BasicStroke((2f * scale).coerceAtLeast(1.5f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            val speaker = Path2D.Float()
            speaker.moveTo((x - 13 * scale).toDouble(), (y - 4 * scale).toDouble())
            speaker.lineTo((x - 7 * scale).toDouble(), (y - 4 * scale).toDouble())
            speaker.lineTo((x + 2 * scale).toDouble(), (y - 12 * scale).toDouble())
            speaker.lineTo((x + 2 * scale).toDouble(), (y + 12 * scale).toDouble())
            speaker.lineTo((x - 7 * scale).toDouble(), (y + 4 * scale).toDouble())
            speaker.lineTo((x - 13 * scale).toDouble(), (y + 4 * scale).toDouble())
            speaker.closePath()
            g.draw(speaker)
            if (audible) g.drawArc(x - (2 * scale).roundToInt(), y - (12 * scale).roundToInt(), (20 * scale).roundToInt(), (24 * scale).roundToInt(), -55, 110)
            else g.drawLine((x + 6 * scale).roundToInt(), (y - 10 * scale).roundToInt(), (x + 18 * scale).roundToInt(), (y + 10 * scale).roundToInt())
        }

        private fun drawSubtitleIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((1.8f * scale).coerceAtLeast(1.3f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            val width = (20 * scale).roundToInt()
            val height = (14 * scale).roundToInt()
            g.drawRoundRect(x - width / 2, y - height / 2, width, height, (3 * scale).roundToInt(), (3 * scale).roundToInt())
            g.drawLine(x - (6 * scale).roundToInt(), y + (2 * scale).roundToInt(), x - (1 * scale).roundToInt(), y + (2 * scale).roundToInt())
            g.drawLine(x + (2 * scale).roundToInt(), y + (2 * scale).roundToInt(), x + (7 * scale).roundToInt(), y + (2 * scale).roundToInt())
        }

        private fun drawAudioIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((1.8f * scale).coerceAtLeast(1.3f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.drawArc(x - (11 * scale).roundToInt(), y - (11 * scale).roundToInt(), (22 * scale).roundToInt(), (22 * scale).roundToInt(), 0, 180)
            g.drawRoundRect(x - (12 * scale).roundToInt(), y - (1 * scale).roundToInt(), (5 * scale).roundToInt(), (10 * scale).roundToInt(), (3 * scale).roundToInt(), (3 * scale).roundToInt())
            g.drawRoundRect(x + (7 * scale).roundToInt(), y - (1 * scale).roundToInt(), (5 * scale).roundToInt(), (10 * scale).roundToInt(), (3 * scale).roundToInt(), (3 * scale).roundToInt())
        }

        private fun drawEpisodesIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((1.8f * scale).coerceAtLeast(1.3f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.drawRoundRect(x - (10 * scale).roundToInt(), y - (10 * scale).roundToInt(), (20 * scale).roundToInt(), (20 * scale).roundToInt(), (3 * scale).roundToInt(), (3 * scale).roundToInt())
            g.drawLine(x - (6 * scale).roundToInt(), y - (4 * scale).roundToInt(), x + (6 * scale).roundToInt(), y - (4 * scale).roundToInt())
            g.drawLine(x - (6 * scale).roundToInt(), y + (2 * scale).roundToInt(), x + (6 * scale).roundToInt(), y + (2 * scale).roundToInt())
        }

        private fun drawSourcesIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((1.8f * scale).coerceAtLeast(1.3f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            g.drawRoundRect(x - (10 * scale).roundToInt(), y - (7 * scale).roundToInt(), (20 * scale).roundToInt(), (12 * scale).roundToInt(), (3 * scale).roundToInt(), (3 * scale).roundToInt())
            g.drawRoundRect(x - (7 * scale).roundToInt(), y - (11 * scale).roundToInt(), (14 * scale).roundToInt(), (8 * scale).roundToInt(), (3 * scale).roundToInt(), (3 * scale).roundToInt())
        }

        private fun drawFullscreenIcon(g: Graphics2D, x: Int, y: Int, scale: Float) {
            g.stroke = BasicStroke((1.8f * scale).coerceAtLeast(1.3f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            val half = (9 * scale).roundToInt()
            val inner = (4 * scale).roundToInt()
            g.drawLine(x - half, y - inner, x - half, y - half)
            g.drawLine(x - half, y - half, x - inner, y - half)
            g.drawLine(x + half, y - inner, x + half, y - half)
            g.drawLine(x + half, y - half, x + inner, y - half)
            g.drawLine(x - half, y + inner, x - half, y + half)
            g.drawLine(x - half, y + half, x - inner, y + half)
            g.drawLine(x + half, y + inner, x + half, y + half)
            g.drawLine(x + half, y + half, x + inner, y + half)
        }

        private fun seekAt(x: Int) {
            val layout = geometry()
            val left = layout.progressLeft
            val right = layout.progressRight
            if (right <= left) return
            val fraction = ((x - left).toFloat() / (right - left).toFloat()).coerceIn(0f, 1f)
            actions.get().onSeekTo((state.get().durationMs * fraction).toLong())
        }

        private fun volumeAt(x: Int) {
            val layout = geometry()
            val left = layout.volumeLeft
            val right = layout.volumeRight
            val fraction = ((x - left).toFloat() / (right - left).toFloat()).coerceIn(0f, 1f)
            actions.get().onSetVolume(fraction * 100f)
        }
    }

    private fun formatDesktopTime(milliseconds: Long): String {
        if (milliseconds <= 0L) return "00:00"
        val totalSeconds = milliseconds / 1_000L
        val seconds = totalSeconds % 60L
        val minutes = (totalSeconds / 60L) % 60L
        val hours = totalSeconds / 3_600L
        return if (hours > 0L) "$hours:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
        else "${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    }
}
