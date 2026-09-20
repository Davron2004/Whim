#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static WKContentRuleList *WhimWebViewNetworkDenyRuleList;

@interface WKWebView (WhimNetworkDeny)
- (instancetype)initWhimNetworkDeniedWithFrame:(CGRect)frame
                                  configuration:(WKWebViewConfiguration *)configuration;
@end

/**
 * Installs platform-release-readiness D17 before app code creates a WKWebView. The replacement
 * starts with "init" plus a capital letter so ARC keeps the original initializer's ownership.
 */
@interface WhimWebViewNetworkDeny : NSObject
@end

@implementation WhimWebViewNetworkDeny

+ (void)load
{
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Method original = class_getInstanceMethod(
        WKWebView.class, @selector(initWithFrame:configuration:));
    Method replacement = class_getInstanceMethod(
        WKWebView.class, @selector(initWhimNetworkDeniedWithFrame:configuration:));
    method_exchangeImplementations(original, replacement);

    dispatch_async(dispatch_get_main_queue(), ^{
      NSURL *rulesURL = [[NSBundle mainBundle] URLForResource:@"WebViewNetworkDeny"
                                                withExtension:@"json"];
      if (rulesURL == nil) {
        NSLog(@"WhimNetworkDeny: missing WebViewNetworkDeny.json");
        return;
      }

      NSError *readError = nil;
      NSString *rules = [NSString stringWithContentsOfURL:rulesURL
                                                  encoding:NSUTF8StringEncoding
                                                     error:&readError];
      if (rules == nil) {
        NSLog(@"WhimNetworkDeny: failed to read WebViewNetworkDeny.json: %@",
              readError.localizedDescription);
        return;
      }

      [[WKContentRuleListStore defaultStore]
          compileContentRuleListForIdentifier:@"whim-webview-network-deny-v1"
                       encodedContentRuleList:rules
                            completionHandler:^(WKContentRuleList *ruleList, NSError *error) {
        if (ruleList == nil) {
          NSLog(@"WhimNetworkDeny: failed to compile WebViewNetworkDeny.json: %@",
                error.localizedDescription);
          return;
        }
        WhimWebViewNetworkDenyRuleList = ruleList;
      }];
    });
  });
}

@end

@implementation WKWebView (WhimNetworkDeny)

- (instancetype)initWhimNetworkDeniedWithFrame:(CGRect)frame
                                  configuration:(WKWebViewConfiguration *)configuration
{
  WKContentRuleList *ruleList = WhimWebViewNetworkDenyRuleList;
  if (ruleList != nil) {
    [configuration.userContentController addContentRuleList:ruleList];
  } else {
    configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
    NSLog(@"WhimNetworkDeny: rule list unavailable at WKWebView initialization");
  }
  return [self initWhimNetworkDeniedWithFrame:frame configuration:configuration];
}

@end
