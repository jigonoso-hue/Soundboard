plugins {
    kotlin("jvm")
}

// Java 17 bytecode, the level Android builds use (compiled with whatever JDK is installed).
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    // Android ships org.json; the JVM tests need a copy.
    compileOnly("org.json:json:20231013")
    testImplementation("org.json:json:20231013")
    // WebSockets: OkHttp for connecting out, Java-WebSocket for hosting at the table.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    useJUnit()
    testLogging { events("passed", "failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL; showStandardStreams = false }
}
