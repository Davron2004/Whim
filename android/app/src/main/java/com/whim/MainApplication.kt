package com.whim

import android.app.Application
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.reactnativecommunity.webview.RNCWebViewPackage
import com.whim.webview.NetworkDeniedWebViewPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          var replacedWebViewPackages = 0
          for (index in indices) {
            if (this[index] is RNCWebViewPackage) {
              // D17 replaces the autolinked package in place because bridgeless registration
              // silently takes the last manager with a duplicate name; exactly one must exist.
              this[index] = NetworkDeniedWebViewPackage()
              replacedWebViewPackages++
            }
          }
          check(replacedWebViewPackages == 1) {
            "react-native-webview autolinking must provide exactly one RNCWebViewPackage; found $replacedWebViewPackages"
          }
          // In-app TurboModules (not autolinked — they live in this app, not node_modules):
          // WhimTone audio cues (effects-and-cues D6), WhimAppInfo (request-envelope D2) and
          // WhimAgeSignal (legal-surface-v2 D11); WhimHaptics (design-system-v1 D11).
          add(com.whim.tone.WhimTonePackage())
          add(com.whim.haptics.WhimHapticsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // The shell is light only (one fixed theme on every device). Pinning the app to day mode keeps
    // the navigation bar's icons (the gesture handle, the three buttons) dark over it: edge to edge
    // (`edgeToEdgeEnabled`), React Native sets the navigation-bar icon colour of the app's window and
    // of every Modal's from the configuration's night mode, so a phone in dark mode would otherwise
    // draw light navigation icons on the cream background. The status bar's icons are the JS
    // `StatusBar`'s (`LauncherRoot`).
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
    loadReactNative(this)
  }
}
