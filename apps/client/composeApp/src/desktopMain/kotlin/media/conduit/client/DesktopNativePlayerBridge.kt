package media.conduit.client

import java.awt.Canvas
import java.awt.Color
import java.awt.Component
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal class DesktopPlayerHost : Canvas() {
    var onPeerReady: (() -> Unit)? = null

    init {
        background = Color.BLACK
        ignoreRepaint = true
    }

    override fun addNotify() {
        super.addNotify()
        onPeerReady?.invoke()
    }

    override fun removeNotify() {
        onPeerReady = null
        super.removeNotify()
    }
}

internal object AwtX11WindowResolver {
    private val peerField by lazy {
        Component::class.java.getDeclaredField("peer").apply { isAccessible = true }
    }

    fun resolve(component: Component): Long {
        check(component.isDisplayable) { "The desktop player canvas is not displayable" }
        val peer = checkNotNull(peerField.get(component)) { "The desktop player canvas has no native peer" }
        val method = generateSequence(peer.javaClass) { it.superclass }
            .mapNotNull { type -> type.declaredMethods.firstOrNull { it.name == "getWindow" && it.parameterCount == 0 } }
            .firstOrNull()
            ?: error("The AWT X11 peer does not expose its window ID")
        method.isAccessible = true
        return (method.invoke(peer) as Number).toLong().also {
            check(it != 0L) { "The AWT X11 window ID is zero" }
        }
    }
}

internal object DesktopNativePlayerBridge {
    val loadError: Throwable? = runCatching { loadLibrary() }.exceptionOrNull()
    val available: Boolean get() = loadError == null

    external fun create(
        windowId: Long,
        url: String,
        headers: Array<String>,
        startPositionMs: Long,
        paused: Boolean,
    ): Long

    external fun dispose(handle: Long)
    external fun setPaused(handle: Long, paused: Boolean)
    external fun seekTo(handle: Long, positionMs: Long)
    external fun positionMs(handle: Long): Long
    external fun durationMs(handle: Long): Long
    external fun videoWidth(handle: Long): Int
    external fun videoHeight(handle: Long): Int
    external fun isPaused(handle: Long): Boolean
    external fun isLoading(handle: Long): Boolean
    external fun isEnded(handle: Long): Boolean

    private fun loadLibrary() {
        check(System.getProperty("os.name").contains("linux", ignoreCase = true)) {
            "Native desktop playback currently supports Linux only"
        }
        val libraryName = "libconduit_player.so"
        val explicit = System.getProperty("conduit.player.bridge")
            ?.takeIf(String::isNotBlank)
            ?.let(::File)
        val packaged = System.getProperty("compose.application.resources.dir")
            ?.takeIf(String::isNotBlank)
            ?.let(::File)
            ?.resolve("native/linux/$libraryName")
        val workingDirectory = File(System.getProperty("user.dir"))
        val candidates = listOfNotNull(
            explicit,
            packaged,
            workingDirectory.resolve("composeApp/build/native/linux/$libraryName"),
            workingDirectory.resolve("build/native/linux/$libraryName"),
        )
        val library = candidates.firstOrNull(File::isFile) ?: extractPackagedLibrary(libraryName)
        System.load(library.absolutePath)
    }

    private fun extractPackagedLibrary(libraryName: String): File {
        val resource = DesktopNativePlayerBridge::class.java
            .getResourceAsStream("/native/linux/$libraryName")
            ?: error("Build the Linux player bridge with :composeApp:buildLinuxPlayerBridge")
        val directory = Files.createTempDirectory("conduit-player-")
        val library = directory.resolve(libraryName)
        resource.use { Files.copy(it, library, StandardCopyOption.REPLACE_EXISTING) }
        library.toFile().deleteOnExit()
        directory.toFile().deleteOnExit()
        return library.toFile()
    }
}
