package com.whim.webview

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.facebook.react.uimanager.ThemedReactContext
import com.reactnativecommunity.webview.RNCWebView
import com.whim.BuildConfig

/**
 * webview-bridge-provenance D6: the native second layer behind the outer page's token. On the
 * web-message-listener path the platform says which frame posted, so a post from any frame but
 * the main one never reaches JavaScript. The library's own listener forwards every frame.
 *
 * Registering the listener before `super` works because the library only creates its own when
 * `bridgeListener` is still null; `super` then runs its unchanged tail (the injected-object
 * script). Without WEB_MESSAGE_LISTENER `super` takes the library's `addJavascriptInterface`
 * fallback unchanged: that path carries no frame identity, so the token check alone refuses.
 */
@SuppressLint("ViewConstructor")
class MainFrameOnlyWebView(context: ThemedReactContext) : RNCWebView(context) {
  private var forcedJavascriptInterfaceBridge: JavascriptInterfaceBridge? = null

  override fun createRNCWebViewBridge(webView: RNCWebView) {
    if (BuildConfig.WHIM_FORCE_JS_INTERFACE_BRIDGE) {
      createForcedJavascriptInterfaceBridge()
      return
    }
    if (bridgeListener == null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      val listener = WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
        if (!isMainFrame) return@WebMessageListener
        onMessage(message.data, sourceOrigin.toString())
      }
      bridgeListener = listener
      WebViewCompat.addWebMessageListener(webView, JAVASCRIPT_INTERFACE, setOf("*"), listener)
    }
    super.createRNCWebViewBridge(webView)
  }

  /**
   * Debug builds only (app/build.gradle): reproduces the library's fallback on a WebView that
   * supports the listener, so the token-only case can run on an emulator. The library's bridge
   * class can't be constructed from outside its package, so this one mirrors its postMessage.
   */
  @SuppressLint("AddJavascriptInterface")
  private fun createForcedJavascriptInterfaceBridge() {
    if (forcedJavascriptInterfaceBridge == null) {
      val bridge = JavascriptInterfaceBridge()
      forcedJavascriptInterfaceBridge = bridge
      addJavascriptInterface(bridge, JAVASCRIPT_INTERFACE)
    }
    setInjectedJavaScriptObject(injectedJavaScriptObject)
  }

  private inner class JavascriptInterfaceBridge {
    @JavascriptInterface
    fun postMessage(message: String) {
      if (messagingEnabled) {
        post { onMessage(message, url) }
      }
    }
  }
}
