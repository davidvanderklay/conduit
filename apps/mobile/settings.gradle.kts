pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        if (System.getenv("CONDUIT_P2P") == "1") {
            maven {
                url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
                content { includeGroup("org.rustls") }
            }
        }
    }
}
rootProject.name = "conduit-mobile"
include(":composeApp")
