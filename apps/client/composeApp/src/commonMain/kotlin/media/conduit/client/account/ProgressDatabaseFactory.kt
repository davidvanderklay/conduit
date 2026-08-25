package media.conduit.client.account

import androidx.compose.runtime.Composable
import media.conduit.client.progressdb.ProgressDatabase

@Composable
expect fun rememberProgressDatabase(): ProgressDatabase?
