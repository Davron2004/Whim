// ─────────────────────────────────────────────────────────────────────────────
// WhimRandomModule — the iOS half of the WhimRandom TurboModule (webview-bridge-provenance D1).
// Hermes has no `crypto` global, so the per-WebView-instance bridge token is minted here from
// `SecRandomCopyBytes`, the system CSPRNG. `randomHex:` is synchronous and returns `byteCount`
// bytes as lowercase hex, or nil (null in JS) when `byteCount` is not an integer in 1–64 or the
// call returns anything but errSecSuccess. There is no fallback generator: nil means the caller
// has no token and must fail closed.
// ─────────────────────────────────────────────────────────────────────────────
#import <WhimAppSpecs/WhimAppSpecs.h>
#import <Security/Security.h>

using namespace facebook::react;

namespace {

constexpr double kMinBytes = 1;
constexpr double kMaxBytes = 64;

} // namespace

@interface WhimRandomModule : NSObject <NativeWhimRandomSpec>
@end

@implementation WhimRandomModule

+ (NSString *)moduleName
{
  return @"WhimRandom";
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSString *_Nullable)randomHex:(double)byteCount
{
  if (byteCount != floor(byteCount) || byteCount < kMinBytes || byteCount > kMaxBytes) {
    return nil;
  }
  const size_t length = (size_t)byteCount;
  uint8_t bytes[(size_t)kMaxBytes];
  int status = SecRandomCopyBytes(kSecRandomDefault, length, bytes);
  if (status != errSecSuccess) {
    return nil;
  }
  NSMutableString *hex = [NSMutableString stringWithCapacity:length * 2];
  for (size_t index = 0; index < length; index++) {
    [hex appendFormat:@"%02x", bytes[index]];
  }
  return hex;
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeWhimRandomSpecJSI>(params);
}

@end
