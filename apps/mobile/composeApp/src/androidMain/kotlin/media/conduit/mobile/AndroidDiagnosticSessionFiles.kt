package media.conduit.mobile

import java.io.File
import media.conduit.mobile.account.DiagnosticSessionFiles
import media.conduit.mobile.account.diagnosticSessionMaxBytes

internal class AndroidDiagnosticSessionFiles(private val directory: File) : DiagnosticSessionFiles {
    override fun read(name: String): String? {
        val file = File(directory, name)
        if (!file.exists()) return null
        check(file.length() <= diagnosticSessionMaxBytes)
        return file.readText()
    }

    override fun write(name: String, text: String) {
        check(directory.isDirectory || directory.mkdirs())
        val temporary = File(directory, "$name.tmp")
        temporary.writeText(text)
        check(temporary.renameTo(File(directory, name)))
    }

    override fun delete(name: String) {
        val file = File(directory, name)
        check(!file.exists() || file.delete())
    }
}
