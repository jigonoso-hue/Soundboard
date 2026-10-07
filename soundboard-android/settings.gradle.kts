// Dungeon Radio for Android. `core` is plain Kotlin (the Live Session engine,
// game and dice rules, and the native side of the web screens), built and
// tested on any JVM; `app` is the Android app (a WebView around the Mac app's
// web screens) and needs the Android SDK.
pluginManagement {
    plugins {
        id("com.android.application") version "8.7.3"
        kotlin("android") version "2.1.21"
    }
    repositories {
        gradlePluginPortal()
        // The Android Gradle plugin (only the app needs it).
        google()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "DungeonRadio"
include(":core")
// The app needs the Android SDK (Android Studio sets it in local.properties).
if (file("local.properties").let { it.isFile && it.readText().contains("sdk.dir") } || System.getenv("ANDROID_HOME") != null) {
    include(":app")
}
