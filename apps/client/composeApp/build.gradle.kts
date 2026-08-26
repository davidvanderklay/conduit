import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.gradle.jvm.tasks.Jar

val androidReleaseKeystore = providers.environmentVariable("ANDROID_KEYSTORE_FILE").orNull
val androidReleaseStorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val androidReleaseKeyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val androidReleaseKeyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.android.application")
    id("app.cash.sqldelight")
}

kotlin {
    androidTarget {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
    jvm("desktop") {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        outputModuleName = "conduit-client"
        browser {
            commonWebpackConfig {
                outputFileName = "conduit-client.js"
            }
        }
        binaries.executable()
    }
    listOf(iosArm64(), iosSimulatorArm64(), iosX64()).forEach { target ->
        target.binaries.framework {
            baseName = "ComposeApp"
            isStatic = true
            val mobileBridge = rootProject.projectDir.resolve(
                "native/ios/${target.name}/libconduit_mobile.a",
            )
            linkerOpts(
                "-lsqlite3",
                "-Wl,-force_load,${mobileBridge.absolutePath}",
            )
        }
        target.compilations.getByName("main").cinterops.create("conduitMobile") {
            definitionFile.set(project.file("src/nativeInterop/cinterop/conduit_mobile.def"))
            includeDirs(rootProject.file("../../packages/mobile-bridge/include"))
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
            implementation("io.ktor:ktor-client-core:3.5.1")
            implementation("io.ktor:ktor-client-content-negotiation:3.5.1")
            implementation("io.ktor:ktor-serialization-kotlinx-json:3.5.1")
            implementation("io.coil-kt.coil3:coil-compose:3.3.0")
            implementation("io.coil-kt.coil3:coil-network-ktor3:3.3.0")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("io.ktor:ktor-client-mock:3.5.1")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
        }
        androidMain.dependencies {
            implementation("app.cash.sqldelight:android-driver:2.3.2")
            implementation("androidx.activity:activity-compose:1.10.1")
            implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
            implementation("androidx.media3:media3-exoplayer:1.10.1")
            implementation("androidx.media3:media3-exoplayer-hls:1.10.1")
            implementation("androidx.media3:media3-exoplayer-dash:1.10.1")
            implementation("androidx.media3:media3-exoplayer-smoothstreaming:1.10.1")
            implementation("androidx.media3:media3-ui:1.10.1")
            implementation("io.github.abdallahmehiz:mpv-android-lib:0.1.12")
            implementation("io.ktor:ktor-client-okhttp:3.5.1")
        }
        androidInstrumentedTest.dependencies {
            implementation("androidx.test:core:1.6.1")
            implementation("androidx.test.ext:junit:1.2.1")
            implementation("androidx.test:runner:1.6.2")
        }
        androidUnitTest.dependencies {
            implementation("app.cash.sqldelight:sqlite-driver:2.3.2")
        }
        iosMain.dependencies {
            implementation("app.cash.sqldelight:native-driver:2.3.2")
            implementation("io.ktor:ktor-client-darwin:3.5.1")
        }
        val desktopMain by getting {
            dependencies {
                implementation(compose.desktop.currentOs)
                implementation("app.cash.sqldelight:sqlite-driver:2.3.2")
                implementation("io.ktor:ktor-client-cio:3.5.1")
            }
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }
        val wasmJsMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-js:3.5.1")
            }
        }
    }
}

compose.desktop {
    application {
        mainClass = "media.conduit.client.MainKt"
        jvmArgs += listOf(
            "--add-opens=java.desktop/java.awt=ALL-UNNAMED",
            "--add-opens=java.desktop/sun.awt.X11=ALL-UNNAMED",
        )
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "Conduit"
            // Native installers reject a zero major version even while the app is in alpha.
            packageVersion = providers.environmentVariable("CONDUIT_PACKAGE_VERSION").orNull ?: "1.0.0"
            description = "Conduit desktop client"
            vendor = "Conduit"
            linux {
                packageName = "media.conduit.desktop.kmp"
            }
            windows {
                packageName = "Conduit"
            }
            macOS {
                bundleID = "media.conduit.desktop.kmp"
                packageName = "Conduit"
            }
        }
    }
}

val linuxPlayerBridgeSource = layout.projectDirectory.file(
    "src/desktopMain/native/linux/conduit_player.cpp",
)
val linuxPlayerBridgeOutput = layout.buildDirectory.file(
    "native/linux/libconduit_player.so",
)
val buildLinuxPlayerBridge = tasks.register<Exec>("buildLinuxPlayerBridge") {
    enabled = System.getProperty("os.name").contains("linux", ignoreCase = true)
    inputs.file(linuxPlayerBridgeSource)
    outputs.file(linuxPlayerBridgeOutput)
    val javaHome = providers.systemProperty("java.home")
    doFirst { linuxPlayerBridgeOutput.get().asFile.parentFile.mkdirs() }
    commandLine(
        "bash",
        "-c",
        "c++ -std=c++17 -shared -fPIC -O2 " +
            "-I'${javaHome.get()}/include' -I'${javaHome.get()}/include/linux' " +
            "$(pkg-config --cflags mpv) " +
            "'${linuxPlayerBridgeSource.asFile.absolutePath}' " +
            "-o '${linuxPlayerBridgeOutput.get().asFile.absolutePath}' " +
            "$(pkg-config --libs mpv) -lpthread",
    )
}

tasks.matching { it.name == "desktopRun" || it.name == "run" }.configureEach {
    dependsOn(buildLinuxPlayerBridge)
}

tasks.named<Jar>("desktopJar") {
    if (System.getProperty("os.name").contains("linux", ignoreCase = true)) {
        dependsOn(buildLinuxPlayerBridge)
        from(linuxPlayerBridgeOutput) { into("native/linux") }
    }
}

sqldelight {
    databases {
        create("ProgressDatabase") {
            packageName.set("media.conduit.client.progressdb")
        }
    }
}

android {
    namespace = "media.conduit.client"
    compileSdk = 36
    sourceSets["main"].res.srcDir("../../desktop/icons/android")
    val releaseSigning = if (
        androidReleaseKeystore != null &&
        androidReleaseStorePassword != null &&
        androidReleaseKeyAlias != null &&
        androidReleaseKeyPassword != null
    ) {
        signingConfigs.create("release") {
            storeFile = file(androidReleaseKeystore)
            storePassword = androidReleaseStorePassword
            keyAlias = androidReleaseKeyAlias
            keyPassword = androidReleaseKeyPassword
        }
    } else {
        null
    }
    defaultConfig {
        applicationId = "media.conduit.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.environmentVariable("CONDUIT_VERSION_CODE").orNull?.toIntOrNull() ?: 1
        versionName = providers.environmentVariable("CONDUIT_VERSION_NAME").orNull ?: "0.1.0-spike"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += setOf("arm64-v8a", "x86_64")
        }
    }
    buildTypes.getByName("release") {
        releaseSigning?.let { signingConfig = it }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
}
