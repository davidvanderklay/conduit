package media.conduit.mobile.tv

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import media.conduit.mobile.TvDetailsModel
import media.conduit.mobile.TvPlayerModel
import media.conduit.mobile.TvPresentation
import media.conduit.mobile.TvShellModel
import media.conduit.mobile.TvSignInModel
import media.conduit.mobile.foundation.AppAction
import media.conduit.mobile.foundation.AppState

/** The Android TV and Google TV interface, installed by MainActivity on television devices. */
internal object ConduitTvPresentation : TvPresentation {
    @Composable
    override fun ServerSetup(state: AppState, dispatch: (AppAction) -> Unit) = TvServerSetup(state, dispatch)

    @Composable
    override fun SignIn(model: TvSignInModel) = TvSignIn(model)

    @Composable
    override fun HouseholdSetup(onCreate: (household: String, profile: String) -> Unit) = TvHouseholdSetup(onCreate)

    @Composable
    override fun RecoveryCodes(codes: List<String>, onSaved: () -> Unit) = TvRecoveryCodes(codes, onSaved)

    @Composable
    override fun ConnectionError(message: String, onRetry: () -> Unit, onChangeServer: () -> Unit) =
        TvConnectionError(message, onRetry, onChangeServer)

    @Composable
    override fun Shell(model: TvShellModel) = TvShell(model)

    @Composable
    override fun Details(model: TvDetailsModel) = TvDetails(model)

    @Composable
    override fun QrCode(text: String, modifier: androidx.compose.ui.Modifier) = TvQrCode(text, modifier)

    @Composable
    override fun PlayerOverlays(scope: BoxScope, model: TvPlayerModel) = with(scope) { TvPlayerOverlays(model) }
}
