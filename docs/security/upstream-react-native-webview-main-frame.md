# Upstream issue draft: react-native-webview forwards bridge messages from every frame

For the owner to file at react-native-webview/react-native-webview. Not filed by an agent. Whim's
workaround is in `android/app/src/main/java/com/whim/webview/MainFrameOnlyWebView.kt` and
`ios/Whim/WhimWebViewMainFrame.m` (webview-bridge-provenance D6), locked by
`checks/test/release/webview-main-frame.suite.ts`.

---

**Title:** `onMessage` cannot tell main-frame posts from sub-frame posts (Android listener drops `isMainFrame`, iOS ignores `frameInfo.isMainFrame`)

**Version:** react-native-webview 14.0.1, new architecture. Android System WebView with
`WEB_MESSAGE_LISTENER`; iOS WKWebView.

**Summary.** Any frame in the page that can reach `window.ReactNativeWebView` (Android) or
`window.webkit.messageHandlers.ReactNativeWebView` (iOS) can post to `onMessage`, and the event
does not say which frame posted. Both platforms tell the library which frame sent the message,
and the library drops that information. An app that hosts untrusted content in an iframe has no
way to accept only its own page's messages.

**Android.** `RNCWebView.createRNCWebViewBridge` registers the listener with
`WebViewCompat.addWebMessageListener(webView, "ReactNativeWebView", Set.of("*"), listener)`. The
listener's `onPostMessage(view, message, sourceOrigin, isMainFrame, replyProxy)` receives
`isMainFrame`, but calls `onMessage(message.getData(), sourceOrigin.toString())` without it.
`Set.of("*")` also injects the object into every frame of every origin. The
`injectedJavaScriptForMainFrameOnly` props are stored but never read.

**iOS.** `RNCWebViewImpl userContentController:didReceiveScriptMessage:` forwards `message.body`
and `message.frameInfo.request.URL` to `onMessage` and never reads
`message.frameInfo.isMainFrame`.

**Reproduction.**
1. Render `<WebView originWhitelist={['*']} source={{ html }} onMessage={(e) => console.log(e.nativeEvent.data)} />`
   where `html` contains `<iframe srcdoc="<script>window.ReactNativeWebView ? ReactNativeWebView.postMessage('from-subframe') : webkit.messageHandlers.ReactNativeWebView.postMessage('from-subframe')</script>"></iframe>`.
2. On iOS, and on Android when the iframe can reach the bridge object, `from-subframe` is logged.
   The event carries nothing that tells it apart from a main-frame post.

**Expected.** One of:
- a prop such as `messagingForMainFrameOnly` (default `false` for compatibility) that drops
  posts whose sender is not the main frame, on Android when `isMainFrame` is false and on iOS
  when `frameInfo.isMainFrame` is false; or
- an `isMainFrame` boolean on the `onMessage` event (`nativeEvent.isMainFrame`), so apps can
  filter in JavaScript.

On Android's `addJavascriptInterface` fallback (no `WEB_MESSAGE_LISTENER`) there is no frame
identity; documenting that the field is absent there would be enough.

**Workaround today.** Subclass `RNCWebView` and override `createRNCWebViewBridge` to register a
listener that returns when `isMainFrame` is false before calling `super`, which then skips its own
listener because `bridgeListener` is already set. The new-architecture `RNCWebViewManager` keeps its
`RNCWebViewManagerImpl` private, so the subclass has to be created through a second impl's public
`createViewInstance(context, webView)`. On iOS, swizzle
`RNCWebViewImpl userContentController:didReceiveScriptMessage:`. Both are brittle across library
upgrades. A protected factory hook (`createRNCWebViewInstance`) on the manager would also help.
