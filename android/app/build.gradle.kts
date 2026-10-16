plugins {
    id("com.android.application")
}

android {
    namespace = "io.chintu.aninewshub"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.chintu.aninewshub"
        minSdk = 23
        targetSdk = 36
        versionCode = providers.gradleProperty("androidVersionCode").orNull?.toInt() ?: 1
        versionName = providers.gradleProperty("androidVersionName").orNull ?: "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "release-key.jks")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""
        }
    }

    sourceSets["main"].assets.srcDir("../../site")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.work:work-runtime:2.10.5")
}
