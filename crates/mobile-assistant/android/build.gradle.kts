plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ohi.xgent.mobileassistant"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.health.connect:connect-client:1.1.0")
    // 1.8.1 is published against Kotlin 1.9.21, matching Tauri's Kotlin 1.9
    // compiler. Coroutines 1.10.x publishes Kotlin 2.1 metadata and cannot be
    // consumed by this Android host without upgrading the whole toolchain.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
