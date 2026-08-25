import org.jetbrains.kotlin.gradle.targets.wasm.nodejs.WasmNodeJsEnvSpec
import org.jetbrains.kotlin.gradle.targets.wasm.nodejs.WasmNodeJsPlugin
import org.jetbrains.kotlin.gradle.targets.wasm.nodejs.WasmNodeJsRootPlugin
import org.jetbrains.kotlin.gradle.targets.wasm.yarn.WasmYarnPlugin
import org.jetbrains.kotlin.gradle.targets.wasm.yarn.WasmYarnRootEnvSpec

plugins {
    kotlin("multiplatform") version "2.3.21" apply false
    kotlin("plugin.serialization") version "2.3.21" apply false
    id("org.jetbrains.compose") version "1.10.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
    id("com.android.application") version "8.10.1" apply false
    id("app.cash.sqldelight") version "2.3.2" apply false
}

plugins.withType<WasmNodeJsRootPlugin> {
    the<WasmNodeJsEnvSpec>().apply {
        download.set(false)
        command.set("node")
        download.disallowChanges()
        command.disallowChanges()
    }
}

allprojects {
    plugins.withType<WasmNodeJsPlugin> {
        the<WasmNodeJsEnvSpec>().apply {
            download.set(false)
            command.set("node")
        }
    }

    plugins.withType<WasmYarnPlugin> {
        rootProject.the<WasmYarnRootEnvSpec>().apply {
            download.set(false)
        }
    }
}

tasks.matching { it.name == "wasmRootPackageJson" }.configureEach {
    outputs.upToDateWhen { false }
    doLast {
        val packageJson = layout.buildDirectory.file("wasm/package.json").get().asFile
        val contents = packageJson.readText()
        if (!contents.contains("\"packageManager\"")) {
            packageJson.writeText(
                contents.replace(
                    "\"private\": true,",
                    "\"private\": true,\n  \"packageManager\": \"yarn@1.22.22\",",
                ),
            )
        }
    }
}
