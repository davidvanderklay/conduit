import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.testing.Test

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

val conduitP2p = providers.environmentVariable("CONDUIT_P2P").orElse("0").get().also {
    require(it == "0" || it == "1") { "CONDUIT_P2P must be 0 or 1" }
}
val conduitStoreBuild = providers.environmentVariable("CONDUIT_STORE_BUILD").orElse("0").get().also {
    require(it == "0" || it == "1") { "CONDUIT_STORE_BUILD must be 0 or 1" }
}
require(conduitStoreBuild != "1" || conduitP2p == "0") { "Store builds must exclude P2P" }
val conduitP2pMode = if (conduitP2p == "1") "p2p" else "direct"
val conduitP2pSources = if (conduitP2p == "1") "src/p2pEnabled/kotlin" else "src/p2pDisabled/kotlin"
val rustHostDirectory = rootProject.file("../../target/mobile/$conduitP2pMode/host")

kotlin {
    androidTarget {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
    listOf(iosArm64(), iosSimulatorArm64(), iosX64()).forEach { target ->
        val mobileBridge = rootProject.projectDir.resolve(
            "native/ios/$conduitP2pMode/${target.name}/libconduit_mobile.a",
        )
        target.binaries.framework {
            baseName = "ComposeApp"
            isStatic = true
            linkerOpts(
                "-lsqlite3",
                "-Wl,-force_load,${mobileBridge.absolutePath}",
            )
        }
        // The Kotlin/Native test executable is linked separately from the app
        // framework, so it needs the bridge symbols explicitly as well.
        target.binaries.getTest("DEBUG").linkerOpts(
            "-lsqlite3",
            "-Wl,-force_load,${mobileBridge.absolutePath}",
        )
        target.compilations.getByName("main").cinterops.create("conduitMobile") {
            definitionFile.set(project.file("src/nativeInterop/cinterop/conduit_mobile.def"))
            includeDirs(rootProject.file("../../packages/mobile-bridge/include"))
        }
    }

    sourceSets {
        androidMain { kotlin.srcDir(conduitP2pSources) }
        iosMain { kotlin.srcDir(conduitP2pSources) }
        if (conduitP2p == "1") {
            androidMain { kotlin.srcDir("src/androidP2p/kotlin") }
            androidMain.dependencies { implementation("org.rustls:rustls-platform-verifier:0.2.0") }
        } else {
            androidMain { kotlin.srcDir("src/androidDirect/kotlin") }
        }
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
            implementation("io.ktor:ktor-client-core:3.5.1")
            implementation("io.ktor:ktor-client-websockets:3.5.1")
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
            implementation("com.google.zxing:core:3.5.3")
        }
        androidInstrumentedTest.dependencies {
            implementation("androidx.compose.ui:ui-test-junit4:1.10.0")
            implementation("androidx.test.espresso:espresso-core:3.7.0")
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
    }
}

dependencies {
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.10.0")
}

sqldelight {
    databases {
        create("ProgressDatabase") {
            packageName.set("media.conduit.mobile.progressdb")
        }
    }
}

android {
    namespace = "media.conduit.mobile"
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
        applicationId = providers.environmentVariable("CONDUIT_APPLICATION_ID").orElse("media.conduit.mobile").get()
        minSdk = 26
        targetSdk = 36
        versionCode = providers.environmentVariable("CONDUIT_VERSION_CODE").orNull?.toIntOrNull() ?: 1
        versionName = providers.environmentVariable("CONDUIT_VERSION_NAME").orNull ?: "0.1.0-spike"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += setOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }
    buildTypes.getByName("release") {
        releaseSigning?.let { signingConfig = it }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("main").jniLibs.setSrcDirs(listOf(rootProject.file("native/android/$conduitP2pMode")))
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
}

val buildHostRustBridge by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.resolve("../.."))
    environment("CARGO_TARGET_DIR", rustHostDirectory.absolutePath)
    val features = if (conduitP2p == "1") "host-jni,p2p" else "host-jni"
    commandLine("cargo", "build", "--locked", "-p", "conduit-mobile", "--no-default-features", "--features", features)
}

tasks.withType<Test>().configureEach {
    dependsOn(buildHostRustBridge)
    jvmArgs("-Djava.library.path=${rustHostDirectory.resolve("debug").absolutePath}")
}
