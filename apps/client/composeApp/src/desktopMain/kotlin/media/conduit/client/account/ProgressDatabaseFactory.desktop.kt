package media.conduit.client.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import media.conduit.client.progressdb.ProgressDatabase
import java.nio.file.Files
import java.nio.file.Path

@Composable
actual fun rememberProgressDatabase(): ProgressDatabase? = remember {
    val directory = desktopDataDirectory()
    Files.createDirectories(directory)
    val databaseFile = directory.resolve("progress.db")
    val exists = Files.exists(databaseFile)
    val driver = JdbcSqliteDriver("jdbc:sqlite:${databaseFile.toAbsolutePath()}")
    if (!exists) ProgressDatabase.Schema.create(driver)
    ProgressDatabase(driver)
}

private fun desktopDataDirectory(): Path {
    val home = Path.of(System.getProperty("user.home"))
    val osName = System.getProperty("os.name", "").lowercase()
    return when {
        osName.contains("mac") -> home.resolve("Library/Application Support/Conduit")
        osName.contains("win") -> System.getenv("APPDATA")?.let(Path::of)?.resolve("Conduit")
            ?: home.resolve("AppData/Roaming/Conduit")
        else -> System.getenv("XDG_DATA_HOME")?.let(Path::of)?.resolve("conduit")
            ?: home.resolve(".local/share/conduit")
    }
}
