package media.conduit.mobile

import android.content.Context
import android.os.Looper
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ForwardingRenderer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.text.TextOutput
import java.util.concurrent.atomic.AtomicLong

/**
 * Media3 has no subtitle delay, so the text renderer runs on a shifted clock:
 * with a positive delay it renders cues as if playback were that much earlier.
 * The renderer cannot rewind past samples it already read, so the player
 * re-seeks after the delay changes.
 */
@UnstableApi
internal class SubtitleDelayRenderersFactory(
    context: Context,
    private val delayUs: AtomicLong,
) : DefaultRenderersFactory(context) {
    override fun buildTextRenderers(
        context: Context,
        output: TextOutput,
        outputLooper: Looper,
        extensionRendererMode: Int,
        out: ArrayList<Renderer>,
    ) {
        val first = out.size
        super.buildTextRenderers(context, output, outputLooper, extensionRendererMode, out)
        for (index in first until out.size) out[index] = DelayedTextRenderer(out[index], delayUs)
    }
}

@UnstableApi
private class DelayedTextRenderer(renderer: Renderer, private val delayUs: AtomicLong) : ForwardingRenderer(renderer) {
    override fun render(positionUs: Long, elapsedRealtimeUs: Long) =
        super.render(positionUs - delayUs.get(), elapsedRealtimeUs)

    override fun resetPosition(positionUs: Long, sampleStreamIsResetToKeyFrame: Boolean) =
        super.resetPosition(positionUs - delayUs.get(), sampleStreamIsResetToKeyFrame)
}
