// The Android package is a shell, not a second engine: the game is the same page the browser
// version serves, so this APK is a WebView that opens it and nothing else. That is also why it is
// small — there are no Blizzard assets here and never can be.
plugins {
    id("com.android.application")
}

android {
    namespace = "me.hhkj.warcraft"
    compileSdk = 34

    defaultConfig {
        applicationId = "me.hhkj.warcraft"
        minSdk = 24
        targetSdk = 34
        versionCode = 20000
        versionName = "2.0.0"
    }

    buildTypes {
        release {
            // No keystore on this machine: a release build is signed with the debug key so it
            // installs. Play Store uploads need a real key — see android/README notes in the plan.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Reading the folder the player granted through the Storage Access Framework: DocumentFile
    // walks a tree URI, which is how the shell serves an install without copying any of it in.
    implementation("androidx.documentfile:documentfile:1.0.1")
    // `WebViewCompat.addDocumentStartJavaScript`: the page's `ow3native` bridge has to exist before
    // its first module runs, and no plain WebViewClient callback is early enough.
    implementation("androidx.webkit:webkit:1.11.0")
}
