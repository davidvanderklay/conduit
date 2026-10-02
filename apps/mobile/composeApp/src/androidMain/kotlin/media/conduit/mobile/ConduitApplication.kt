package media.conduit.mobile

import android.app.Application
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import media.conduit.mobile.account.DiagnosticLogStore

class ConduitApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        @Suppress("DEPRECATION")
        val version = packageManager.getPackageInfo(packageName, 0)
        DiagnosticLogStore.startPersistence(
            AndroidDiagnosticSessionFiles(File(noBackupFilesDir, "diagnostics")),
            "Android ${Build.VERSION.RELEASE} ${Build.MANUFACTURER} ${Build.MODEL} " +
                "app=${version.versionName} build=${PackageInfoCompat.getLongVersionCode(version)}",
        )
    }
}
