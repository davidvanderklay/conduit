package media.conduit.mobile.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import media.conduit.mobile.progressdb.ProgressDatabase

@Composable
actual fun rememberProgressDatabase(): ProgressDatabase {
    val context = LocalContext.current.applicationContext
    return remember(context) {
        ProgressDatabase(AndroidSqliteDriver(ProgressDatabase.Schema, context, "conduit-progress.db"))
    }
}
