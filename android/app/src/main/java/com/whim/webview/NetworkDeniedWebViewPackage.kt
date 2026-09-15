package com.whim.webview

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.reactnativecommunity.webview.RNCWebViewPackage

/** Keeps react-native-webview's module provider while replacing its only view manager. */
class NetworkDeniedWebViewPackage : RNCWebViewPackage() {
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return listOf(NetworkDeniedWebViewManager())
  }
}
