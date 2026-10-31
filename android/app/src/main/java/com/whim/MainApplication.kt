package com.whim

import android.app.Application
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
          // WhimAgeSignal (legal-surface-v2 D11); WhimHaptics (design-system-v1 D11);
          // WhimLaunchScreen (design-system-v1 D12).
          add(com.whim.tone.WhimTonePackage())
          add(com.whim.haptics.WhimHapticsPackage())
          add(com.whim.launch.WhimLaunchScreenPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
