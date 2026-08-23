package media.conduit.mobile.account

import androidx.compose.runtime.Composable
import media.conduit.mobile.progressdb.ProgressDatabase

@Composable
expect fun rememberProgressDatabase(): ProgressDatabase
