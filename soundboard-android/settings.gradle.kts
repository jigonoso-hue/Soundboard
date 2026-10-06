// Dungeon Radio for Android. `core` is plain Kotlin (the Live Session engine,
// game and dice rules), built and tested on any JVM; `app` is the Android app
// (Capacitor around the Mac app's web screens) and needs the Android SDK.
pluginManagement {
    repositories {
        gradlePluginPortal()
        // google() is dl.google.com; maven.google.com serves the same artifacts.
        maven("https://maven.google.com")
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositories {
        // google() is dl.google.com; maven.google.com serves the same artifacts.
        maven("https://maven.google.com")
        mavenCentral()
    }
}
rootProject.name = "DungeonRadio"
include(":core")
