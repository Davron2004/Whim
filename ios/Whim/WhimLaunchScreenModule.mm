// ─────────────────────────────────────────────────────────────────────────────
// WhimLaunchScreenModule — the iOS half of the WhimLaunchScreen TurboModule (design-system-v1
// D12). `hide` ends the cold-start hold of the launch screen (`WhimLaunchScreen.swift`) on the
// main queue. Fire-and-forget: nothing returns or throws back to JS.
//
// Registered with `RCT_EXPORT_MODULE`, like `WhimAppInfoModule`: the TurboModule manager falls
// back to registered module classes by name, and `package.json` stays untouched.
// ─────────────────────────────────────────────────────────────────────────────
#import <WhimAppSpecs/WhimAppSpecs.h>
// Whim-Swift.h declares AppDelegate.swift's ReactNativeDelegate, so its superclass must be visible first.
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import "Whim-Swift.h"

using namespace facebook::react;

@interface WhimLaunchScreenModule : NSObject <NativeWhimLaunchScreenSpec>
@end

@implementation WhimLaunchScreenModule

RCT_EXPORT_MODULE(WhimLaunchScreen)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)hide
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [WhimLaunchScreenOverlay hide];
  });
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeWhimLaunchScreenSpecJSI>(params);
}

@end
