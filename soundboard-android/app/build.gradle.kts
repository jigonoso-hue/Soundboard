plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "com.dungeonradio.app"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.dungeonradio.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key until there's a release key (for installing by hand).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The built-in ambience loops are copied out and served as they are.
    androidResources { noCompress += listOf("wav") }

    packaging {
        resources.excludes += listOf("META-INF/*.version", "META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/*.kotlin_module")
    }

    // The Mac app's web screens, put together by scripts/assemble-web.js.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web-assets"))
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))
    // Premium: Google Play's in-app purchases and subscriptions.
    implementation("com.android.billingclient:billing:9.1.0")
}

// Builds the web screens from soundboard-mac (needs Node, and npm install in soundboard-mac).
val assembleWeb by tasks.registering(Exec::class) {
    val out = layout.buildDirectory.dir("generated/web-assets")
    inputs.dir("../web")
    inputs.dir("../../soundboard-mac/src")
    inputs.file("../scripts/assemble-web.js")
    outputs.dir(out)
    commandLine("node", file("../scripts/assemble-web.js").path, out.get().asFile.path)
}
tasks.named("preBuild") { dependsOn(assembleWeb) }
