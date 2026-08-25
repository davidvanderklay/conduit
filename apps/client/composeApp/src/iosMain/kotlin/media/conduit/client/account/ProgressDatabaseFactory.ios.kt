package media.conduit.client.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import media.conduit.client.progressdb.ProgressDatabase

@Composable
actual fun rememberProgressDatabase(): ProgressDatabase? = remember {
    ProgressDatabase(NativeSqliteDriver(ProgressDatabase.Schema, "conduit-progress.db"))
}
