package media.conduit.client

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import media.conduit.client.account.SubtitleItem

@Serializable
private data class BrowserVideoState(
    val ready: Boolean = false,
    val paused: Boolean = true,
    val ended: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
    val error: String? = null,
)

private val browserVideoJson = Json { ignoreUnknownKeys = true }

@Composable
actual fun NativePlayer(
    url: String?,
    active: Boolean,
    presentation: PlaybackPresentation,
    command: SequencedPlaybackCommand?,
    startPositionMs: Long,
    requestHeaders: Map<String, String>,
    subtitles: List<SubtitleItem>,
    contentLogo: String?,
    contentTitle: String?,
    hasNextEpisode: Boolean,
    onNextEpisode: () -> Unit,
    hasEpisodes: Boolean,
    hasSources: Boolean,
    touchGestures: Boolean,
    holdToSpeed: Boolean,
    preferredAudioLanguage: String,
    preferredSubtitleLanguage: String,
    androidPlaybackEngine: AndroidPlaybackEngine,
    onEpisodes: () -> Unit,
    onSources: () -> Unit,
    controlsVisible: Boolean,
    onBack: () -> Unit,
    onControlsVisibilityChanged: (Boolean) -> Unit,
    onOverlayVisibilityChanged: (Boolean) -> Unit,
    onTemporarySpeedChanged: (Boolean) -> Unit,
    onSystemPipChanged: (Boolean) -> Unit,
    onSystemPipAvailabilityChanged: (Boolean) -> Unit,
    interactiveResize: Boolean,
    modifier: Modifier,
    onState: (PlaybackState) -> Unit,
) {
    LaunchedEffect(Unit) {
        onSystemPipAvailabilityChanged(false)
        onSystemPipChanged(false)
        onControlsVisibilityChanged(true)
        onOverlayVisibilityChanged(false)
    }

    LaunchedEffect(active, url, requestHeaders, startPositionMs) {
        if (active && url != null) {
            browserPlayerSetSource(
                url,
                browserVideoJson.encodeToString(requestHeaders),
                startPositionMs.toDouble(),
            )
        } else {
            browserPlayerDetach()
        }
    }

    LaunchedEffect(command?.sequence) {
        when (val action = command?.command) {
            PlaybackCommand.Play -> browserPlayerSetPaused(false)
            PlaybackCommand.Pause -> browserPlayerSetPaused(true)
            is PlaybackCommand.SeekTo -> browserPlayerSeekTo(action.positionMs.toDouble())
            PlaybackCommand.RetryVideoOutput -> if (active && url != null) {
                browserPlayerSetSource(
                    url,
                    browserVideoJson.encodeToString(requestHeaders),
                    startPositionMs.toDouble(),
                )
            }
            PlaybackCommand.EnterSystemPip, null -> Unit
        }
    }

    LaunchedEffect(active, url) {
        while (active && url != null) {
            val current = runCatching { browserVideoJson.decodeFromString<BrowserVideoState>(browserPlayerState()) }
                .getOrElse { BrowserVideoState(error = it.message ?: "Unable to read browser playback state") }
            onState(
                PlaybackState(
                    loading = !current.ready && current.error == null,
                    buffering = !current.ready && current.error == null,
                    playing = current.ready && !current.paused && !current.ended,
                    positionMs = current.positionMs,
                    durationMs = current.durationMs,
                    videoWidth = current.videoWidth,
                    videoHeight = current.videoHeight,
                    ended = current.ended,
                    error = current.error,
                    pipReady = false,
                    engine = NativePlaybackEngine.Browser,
                ),
            )
            delay(250)
        }
        if (!active || url == null) onState(PlaybackState())
    }

    // The video element is a transparent, pointer-free layer behind the Compose
    // canvas. Shared Compose controls remain the only interactive surface.
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val error = runCatching {
            browserVideoJson.decodeFromString<BrowserVideoState>(browserPlayerState()).error
        }.getOrNull()
        if (active && error != null) {
            Text(error, color = MaterialTheme.colorScheme.error)
        }
    }
}

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    (url, headersJson, startPositionMs) => {
      const id = 'conduit-wasm-player';
      let player = document.getElementById(id);
      if (!player) {
        player = document.createElement('video');
        player.id = id;
        player.playsInline = true;
        player.preload = 'auto';
        player.controls = false;
        player.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:-1;pointer-events:none;display:block';
        document.body.appendChild(player);
      }
      player.style.display = 'block';
      window.__conduitWasmPlayerGeneration = (window.__conduitWasmPlayerGeneration || 0) + 1;
      const generation = window.__conduitWasmPlayerGeneration;
      if (window.__conduitWasmPlayerObjectUrl) {
        URL.revokeObjectURL(window.__conduitWasmPlayerObjectUrl);
        window.__conduitWasmPlayerObjectUrl = null;
      }
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.dataset.error = '';
      const start = () => {
        if (generation !== window.__conduitWasmPlayerGeneration) return;
        if (startPositionMs > 0) player.currentTime = startPositionMs / 1000;
        void player.play().catch(() => {});
      };
      player.onloadedmetadata = start;
      try {
        const headers = JSON.parse(headersJson || '{}');
        if (Object.keys(headers).length === 0) {
          player.src = url;
          player.load();
          return;
        }
        fetch(url, { headers, credentials: 'omit' })
          .then(response => {
            if (!response.ok) throw new Error('Video request returned HTTP ' + response.status);
            return response.blob();
          })
          .then(blob => {
            if (generation !== window.__conduitWasmPlayerGeneration) return;
            const objectUrl = URL.createObjectURL(blob);
            window.__conduitWasmPlayerObjectUrl = objectUrl;
            player.src = objectUrl;
            player.load();
          })
          .catch(error => {
            if (generation === window.__conduitWasmPlayerGeneration) player.dataset.error = error?.message || 'Unable to load browser video';
          });
      } catch (error) {
        player.dataset.error = error?.message || 'Unable to load browser video';
      }
    }
""")
private external fun browserPlayerSetSource(url: String, headersJson: String, startPositionMs: Double)

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    () => {
      const player = document.getElementById('conduit-wasm-player');
      if (!player) return;
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.style.display = 'none';
    }
""")
private external fun browserPlayerDetach()

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    (paused) => {
      const player = document.getElementById('conduit-wasm-player');
      if (!player) return;
      if (paused) player.pause(); else void player.play().catch(() => {});
    }
""")
private external fun browserPlayerSetPaused(paused: Boolean)

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    (positionMs) => {
      const player = document.getElementById('conduit-wasm-player');
      if (player && Number.isFinite(positionMs)) player.currentTime = Math.max(0, positionMs / 1000);
    }
""")
private external fun browserPlayerSeekTo(positionMs: Double)

@OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@JsFun("""
    () => {
      const player = document.getElementById('conduit-wasm-player');
      if (!player) return JSON.stringify({});
      const error = player.dataset.error || null;
      return JSON.stringify({
        ready: player.readyState >= 3,
        paused: player.paused,
        ended: player.ended,
        positionMs: Number.isFinite(player.currentTime) ? Math.round(player.currentTime * 1000) : 0,
        durationMs: Number.isFinite(player.duration) ? Math.round(player.duration * 1000) : 0,
        videoWidth: player.videoWidth || 0,
        videoHeight: player.videoHeight || 0,
        error,
      });
    }
""")
private external fun browserPlayerState(): String
