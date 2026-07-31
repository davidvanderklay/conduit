package media.conduit.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun App() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        val client = remember { EngineClient() }
        var engineState by remember { mutableStateOf<EngineState?>(null) }
        var playback by remember { mutableStateOf(PlaybackState()) }
        var playerOpen by remember { mutableStateOf(false) }
        val resolved = engineState as? EngineState.Resolved

        DisposableEffect(client) {
            onDispose {
                runCatching { client.dispatch(EngineAction.Close()) }
                client.close()
            }
        }

        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().safeContentPadding().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Conduit", style = MaterialTheme.typography.headlineMedium)
                Text("Compose + Rust architecture spike", color = MaterialTheme.colorScheme.secondary)
                Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Connection", style = MaterialTheme.typography.titleMedium)
                        Text("Deterministic local add-on fixture")
                        Button(onClick = {
                            engineState = client.dispatch(EngineAction.ResolveFixture())
                            playerOpen = false
                        }) { Text("Resolve catalog item") }
                        when (val state = engineState) {
                            is EngineState.Resolved -> {
                                Text("${state.addonName} · ${state.streamTitle}")
                                Text(state.requestUrl, style = MaterialTheme.typography.bodySmall)
                                Button(onClick = { playerOpen = true }) { Text("Play legal test stream") }
                            }
                            is EngineState.Error -> Text("${state.code}: ${state.message}")
                            is EngineState.Cancelled -> Text("Resolution cancelled")
                            else -> Unit
                        }
                    }
                }
                if (playerOpen && resolved != null) {
                    NativePlayer(
                        url = resolved.streamUrl,
                        active = true,
                        modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                        onState = { playback = it },
                    )
                    Text(
                        "Native player · ${playback.positionMs / 1000}s / ${playback.durationMs / 1000}s" +
                            if (playback.playing) " · playing" else " · paused",
                    )
                    playback.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    OutlinedButton(onClick = {
                        playerOpen = false
                        engineState = client.dispatch(EngineAction.Cancel())
                    }) { Text("Close player") }
                }
            }
        }
    }
}
