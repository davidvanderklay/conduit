package media.conduit.client.foundation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.util.prefs.Preferences
import java.util.concurrent.TimeUnit

private class PreferencesSettingsStore(private val preferences: Preferences) : SettingsStore {
    override fun get(key: String): String? = preferences.get(key, null)
    override fun put(key: String, value: String) = preferences.put(key, value)
    override fun remove(key: String) = preferences.remove(key)
}

/** Stores large non-secret snapshots without the 8 KiB preference limit. */
private class FileSettingsStore(private val root: Path) : SettingsStore {
    init {
        runCatching { Files.createDirectories(root) }
    }

    override fun get(key: String): String? = runCatching {
        Files.readString(fileFor(key))
    }.getOrNull()

    override fun put(key: String, value: String) {
        runCatching {
            Files.createDirectories(root)
            val temporary = Files.createTempFile(root, ".profile-", ".tmp")
            try {
                Files.writeString(temporary, value)
                Files.move(
                    temporary,
                    fileFor(key),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } finally {
                Files.deleteIfExists(temporary)
            }
        }
    }

    override fun remove(key: String) {
        runCatching { Files.deleteIfExists(fileFor(key)) }
    }

    private fun fileFor(key: String): Path {
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(StandardCharsets.UTF_8))
        val name = digest.joinToString("") { byte -> "%02x".format(byte) }
        return root.resolve("$name.json")
    }
}

/**
 * Uses the desktop OS credential service when it is available. Linux uses the
 * Secret Service command-line client supplied by libsecret. A process-local
 * fallback keeps alpha builds usable without a running user session, but it
 * must not be treated as durable storage.
 */
private class DesktopSecureStore : SecureStore {
    private val fallback = MemorySecureStore()
    private val backend: SecretToolStore? = when {
        System.getProperty("os.name", "").contains("linux", ignoreCase = true) ->
            SecretToolStore().takeIf { it.available }
        else -> null
    }

    override fun get(key: String): String? = backend?.get(key) ?: fallback.get(key)

    override fun put(key: String, value: String) {
        if (backend?.putIfAvailable(key, value) != true) fallback.put(key, value)
    }

    override fun remove(key: String) {
        backend?.removeIfAvailable(key)
        fallback.remove(key)
    }
}

private class SecretToolStore {
    private val service = "media.conduit.client"
    private val command = "secret-tool"

    val available: Boolean = runCommand(
        listOf(command, "lookup", "service", service, "key", "__conduit_probe__"),
    ).exitCode != -1

    fun get(key: String): String? {
        val result = runCommand(listOf(command, "lookup", "service", service, "key", key))
        return result.output.takeIf { result.exitCode == 0 && it.isNotBlank() }?.trimEnd('\n', '\r')
    }

    fun putIfAvailable(key: String, value: String): Boolean =
        runCommand(
            listOf(command, "store", "--label=Conduit", "service", service, "key", key),
            value,
        ).exitCode == 0

    fun removeIfAvailable(key: String): Boolean =
        runCommand(listOf(command, "clear", "service", service, "key", key)).exitCode == 0

    private fun runCommand(commandLine: List<String>, input: String? = null): CommandResult {
        val process = runCatching {
            ProcessBuilder(commandLine)
                .redirectErrorStream(true)
                .start()
        }.getOrNull() ?: return CommandResult(-1, "")
        if (input != null) {
            OutputStreamWriter(process.outputStream, StandardCharsets.UTF_8).use { writer ->
                writer.write(input)
                writer.write('\n'.code)
            }
        } else {
            process.outputStream.close()
        }
        val output = process.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
        if (!process.waitFor(5, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            return CommandResult(-1, "")
        }
        return CommandResult(process.exitValue(), output)
    }

    private data class CommandResult(val exitCode: Int, val output: String)
}

@Composable
actual fun rememberPlatformServices(): PlatformServices = remember {
    val osName = System.getProperty("os.name", "Desktop")
    PlatformServices(
        settings = PreferencesSettingsStore(Preferences.userRoot().node("media/conduit/client")),
        secure = DesktopSecureStore(),
        profileCache = FileSettingsStore(
            Path.of(System.getProperty("user.home"), ".local", "share", "conduit", "profile-cache"),
        ),
        info = PlatformInfo(
            name = osName,
            version = System.getProperty("os.version", ""),
            device = System.getProperty("os.arch", ""),
        ),
    )
}

@Composable
actual fun rememberAppLifecycleEvents(
    onForeground: () -> Unit,
    onConnectivityRecovered: () -> Unit,
) {
    LaunchedEffect(Unit) { onForeground() }
}
