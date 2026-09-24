// ─────────────────────────────────────────────────────────────────────────────
// WhimAgeSignalModule — the iOS half of the WhimAgeSignal TurboModule (legal-surface-v2 D11; spec
// store-age-signals).
// ─────────────────────────────────────────────────────────────────────────────
// `check` resolves the store's age signal, already reduced by `WhimAgeSignal.swift` to one of
// `adult`, `minor-approved`, `under-13` or `unavailable`. It never rejects: every failure is
// `unavailable`, which lets the flow continue. The Swift side needs the main queue (Apple's
// sheet is presented over the current screen), so the call hops there first.
//
// Registered with `RCT_EXPORT_MODULE`, like `WhimAppInfoModule`: the TurboModule manager falls
// back to registered module classes by name, and `package.json` stays untouched.
// ─────────────────────────────────────────────────────────────────────────────
#import <WhimAppSpecs/WhimAppSpecs.h>
#import <React/RCTUtils.h>
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import "Whim-Swift.h"

using namespace facebook::react;

@interface WhimAgeSignalModule : NSObject <NativeWhimAgeSignalSpec>
@end

@implementation WhimAgeSignalModule

RCT_EXPORT_MODULE(WhimAgeSignal)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)check:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [WhimAgeSignalReader checkPresenting:RCTPresentedViewController()
                              completion:^(NSString *signal) {
                                resolve(signal);
                              }];
  });
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeWhimAgeSignalSpecJSI>(params);
}

@end
