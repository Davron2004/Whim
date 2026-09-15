package com.whim.webview

import com.facebook.react.uimanager.ThemedReactContext
import com.reactnativecommunity.webview.RNCWebViewManager
import com.reactnativecommunity.webview.RNCWebViewWrapper

/**
 * Applies platform-release-readiness D17's native network refusal before React Native sets
 * properties. ViewManager creates the view before updating properties, so no source can load first.
 */
class NetworkDeniedWebViewManager : RNCWebViewManager() {
  override fun createViewInstance(context: ThemedReactContext): RNCWebViewWrapper {
    val wrapper = super.createViewInstance(context)
    wrapper.webView.settings.blockNetworkLoads = true
    return wrapper
  }
}
