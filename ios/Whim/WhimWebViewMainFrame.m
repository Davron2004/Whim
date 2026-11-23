#import <WebKit/WebKit.h>
#import <objc/runtime.h>

/**
 * The only documents a sub-frame may navigate to (webview-bridge-provenance D9): the mini-app
 * frame's own srcdoc document and an empty one. Compared as whole URLs, so `about:blank#x` or
 * `about:srcdoc?x` is refused like any other document neutralization never ran in.
 */
static NSArray<NSString *> *WhimSubFrameNavigationAllowlist(void)
{
  return @[ @"about:srcdoc", @"about:blank" ];
}

typedef void (*WhimScriptMessageIMP)(id, SEL, WKUserContentController *, WKScriptMessage *);
typedef void (*WhimNavigationPolicyIMP)(
    id, SEL, WKWebView *, WKNavigationAction *, void (^)(WKNavigationActionPolicy));

static WhimScriptMessageIMP WhimOriginalScriptMessage;
static WhimNavigationPolicyIMP WhimOriginalNavigationPolicy;

/**
 * Replaces `selector` on `cls` and returns the implementation it replaced, or NULL. A missing
 * selector means a react-native-webview upgrade moved the seam: a debug build stops on it at
 * launch, a release build logs it and runs without the hook.
 */
static IMP WhimReplaceMethod(Class cls, SEL selector, id block)
{
  Method method = class_getInstanceMethod(cls, selector);
  if (method == NULL) {
    NSLog(@"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));
#if DEBUG
    NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));
#endif
    return NULL;
  }
  IMP inherited = method_getImplementation(method);
  IMP replaced = class_replaceMethod(
      cls, selector, imp_implementationWithBlock(block), method_getTypeEncoding(method));
  return replaced != NULL ? replaced : inherited;
}

/**
 * Installs webview-bridge-provenance D6 and D9 on react-native-webview's RNCWebViewImpl, the
 * WKScriptMessageHandler and WKNavigationDelegate of every WebView the library creates: a script
 * message from any frame but the main one never reaches JavaScript, and a sub-frame cannot
 * navigate to a document the runtime did not create.
 */
@interface WhimWebViewMainFrame : NSObject
@end

@implementation WhimWebViewMainFrame

+ (void)load
{
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Class impl = NSClassFromString(@"RNCWebViewImpl");
    if (impl == Nil) {
      NSLog(@"WhimMainFrame: RNCWebViewImpl is missing");
#if DEBUG
      NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl is missing");
#endif
      return;
    }

    SEL scriptMessage = @selector(userContentController:didReceiveScriptMessage:);
    WhimOriginalScriptMessage = (WhimScriptMessageIMP)WhimReplaceMethod(
        impl, scriptMessage, ^(id webView, WKUserContentController *controller, WKScriptMessage *message) {
          // WebKit exposes every handler the library registers to every frame: its bridge
          // (`ReactNativeWebView`) and its history shim (`ReactNativeHistoryShim`, whose message
          // fires the host's onLoadEnd, RNCWebViewImpl.m). A sub-frame's message to any of them is
          // dropped, whatever the handler's name.
          if (!message.frameInfo.isMainFrame) {
            return;
          }
          WhimOriginalScriptMessage(webView, scriptMessage, controller, message);
        });

    SEL navigationPolicy = @selector(webView:decidePolicyForNavigationAction:decisionHandler:);
    WhimOriginalNavigationPolicy = (WhimNavigationPolicyIMP)WhimReplaceMethod(
        impl, navigationPolicy, ^(id webViewImpl, WKWebView *webView, WKNavigationAction *navigationAction,
                                  void (^decisionHandler)(WKNavigationActionPolicy)) {
          WKFrameInfo *targetFrame = navigationAction.targetFrame;
          NSString *url = navigationAction.request.URL.absoluteString;
          // A nil target frame is a new-window request, which the library already handles.
          if (targetFrame != nil && !targetFrame.isMainFrame
              && ![WhimSubFrameNavigationAllowlist() containsObject:url]) {
            decisionHandler(WKNavigationActionPolicyCancel);
            return;
          }
          WhimOriginalNavigationPolicy(webViewImpl, navigationPolicy, webView, navigationAction, decisionHandler);
        });
  });
}

@end
