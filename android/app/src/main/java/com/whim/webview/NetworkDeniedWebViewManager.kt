package com.whim.webview

import com.facebook.react.uimanager.ThemedReactContext
import com.reactnativecommunity.webview.RNCWebViewManager
import com.reactnativecommunity.webview.RNCWebViewManagerImpl
import com.reactnativecommunity.webview.RNCWebViewWrapper

/**
 * Applies D17's native refusal at the ViewManager.java ordering documented in research.md E:
 * createViewInstance runs before React Native updates properties, so no source can load first.
 *
 * It also builds the WebView as MainFrameOnlyWebView (webview-bridge-provenance D6). The
 * superclass keeps its own impl private, so a second impl runs the library's public two-argument
 * creation path on our instance. Creation reads only that impl's defaults (no-op config, chrome
 * client flags, download messages), which no Whim WebView sets as props; every prop still goes
 * to the superclass's impl.
 */
class NetworkDeniedWebViewManager : RNCWebViewManager() {
  private val creationImpl = RNCWebViewManagerImpl(true)

  override fun createViewInstance(context: ThemedReactContext): RNCWebViewWrapper {
    val wrapper = creationImpl.createViewInstance(context, MainFrameOnlyWebView(context))
    wrapper.webView.settings.blockNetworkLoads = true
    return wrapper
  }
}
