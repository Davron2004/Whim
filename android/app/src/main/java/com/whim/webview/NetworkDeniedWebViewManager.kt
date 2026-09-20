package com.whim.webview

import com.facebook.react.uimanager.ThemedReactContext
import com.reactnativecommunity.webview.RNCWebViewManager
import com.reactnativecommunity.webview.RNCWebViewWrapper

/**
 * Applies D17's native refusal at the ViewManager.java ordering documented in research.md E:
 * createViewInstance runs before React Native updates properties, so no source can load first.
 */
class NetworkDeniedWebViewManager : RNCWebViewManager() {
  override fun createViewInstance(context: ThemedReactContext): RNCWebViewWrapper {
    val wrapper = super.createViewInstance(context)
    wrapper.webView.settings.blockNetworkLoads = true
    return wrapper
  }
}
