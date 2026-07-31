import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.android.application")
}

kotlin {
    androidTarget {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
    }
    listOf(iosArm64(), iosSimulatorArm64(), iosX64()).forEach { target ->
        target.binaries.framework {
            baseName = "ComposeApp"
            isStatic = true
            linkerOpts(
                "-L${rootProject.projectDir}/native/ios/${target.name}",
                "-lconduit_mobile",
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
            implementation(compose.ui)
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
            implementation("io.ktor:ktor-client-core:3.5.1")
            implementation("io.ktor:ktor-client-content-negotiation:3.5.1")
            implementation("io.ktor:ktor-serialization-kotlinx-json:3.5.1")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("io.ktor:ktor-client-mock:3.5.1")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
        }
        androidMain.dependencies {
            implementation("androidx.activity:activity-compose:1.10.1")
            implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
            implementation("androidx.media3:media3-exoplayer:1.10.1")
            implementation("androidx.media3:media3-ui:1.10.1")
            implementation("io.ktor:ktor-client-okhttp:3.5.1")
        }
        androidInstrumentedTest.dependencies {
            implementation("androidx.test:core:1.6.1")
            implementation("androidx.test.ext:junit:1.2.1")
            implementation("androidx.test:runner:1.6.2")
        }
        iosMain.dependencies {
            implementation("io.ktor:ktor-client-darwin:3.5.1")
        }
    }
}

android {
    namespace = "media.conduit.mobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "media.conduit.mobile.spike"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-spike"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
}
