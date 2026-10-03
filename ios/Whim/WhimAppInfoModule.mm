// ─────────────────────────────────────────────────────────────────────────────
// WhimAppInfoModule — the iOS half of the WhimAppInfo TurboModule (request-envelope D2).
// ─────────────────────────────────────────────────────────────────────────────
// Reports the installed app's marketing version (`CFBundleShortVersionString`) and build number
// (`CFBundleVersion`) from the main bundle's Info.plist. fastlane overrides the build number at
// release time, so only the installed binary knows it. Both cross to JS as the raw strings the
// bundle holds; `src/host/launcher/app-info.ts` validates them. A missing or non-string value
// crosses as @"", which that wrapper rejects as missing.
//
// Registered with `RCT_EXPORT_MODULE` rather than a `codegenConfig.ios.modulesProvider` entry
// (how `WhimToneModule` is wired): the TurboModule manager falls back to registered module
// classes by name, and `package.json` stays untouched.
// ─────────────────────────────────────────────────────────────────────────────
#import <WhimAppSpecs/WhimAppSpecs.h>

using namespace facebook::react;

namespace {

NSString *InfoPlistString(NSString *key)
{
  id value = [NSBundle.mainBundle objectForInfoDictionaryKey:key];
  return [value isKindOfClass:NSString.class] ? (NSString *)value : @"";
}

} // namespace

@interface WhimAppInfoModule : NSObject <NativeWhimAppInfoSpec>
@end

@implementation WhimAppInfoModule

RCT_EXPORT_MODULE(WhimAppInfo)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (ModuleConstants<JS::NativeWhimAppInfo::Constants>)constantsToExport
{
  return [self getConstants];
}

- (ModuleConstants<JS::NativeWhimAppInfo::Constants>)getConstants
{
  return typedConstants<JS::NativeWhimAppInfo::Constants>({
      .version = InfoPlistString(@"CFBundleShortVersionString"),
      .build = InfoPlistString(@"CFBundleVersion"),
  });
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeWhimAppInfoSpecJSI>(params);
}

@end
