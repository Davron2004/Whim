// ─────────────────────────────────────────────────────────────────────────────
// WhimHapticsModule — the iOS half of the WhimHaptics TurboModule (design-system-v1 D11;
// docs/design/system.md §5). Plays the UIFeedbackGenerator family: impact (light, medium, heavy,
// rigid, soft, at an intensity), selection and notification. The shell prepares a moment's
// generator on touch-down (`prepare:`) so the haptic lands on the frame of the visual change.
// The system Haptics setting silences every generator on its own. The Android feedback constant
// each shell call carries is ignored here. App cues (`cue:`) map their closed token: `tap` a
// light impact, `double` two light impacts 80 ms apart, `heavy` a heavy impact; unknown tokens
// play as `tap`. Fire-and-forget: every method runs on the main queue, returns nothing and never
// throws back to JavaScript.
// ─────────────────────────────────────────────────────────────────────────────
#import <WhimAppSpecs/WhimAppSpecs.h>
#import <UIKit/UIKit.h>

using namespace facebook::react;

namespace {

constexpr int64_t kDoubleGapNanoseconds = 80 * NSEC_PER_MSEC;

UIImpactFeedbackStyle ImpactStyleForName(NSString *name)
{
  if ([name isEqualToString:@"medium"]) {
    return UIImpactFeedbackStyleMedium;
  }
  if ([name isEqualToString:@"heavy"]) {
    return UIImpactFeedbackStyleHeavy;
  }
  if ([name isEqualToString:@"rigid"]) {
    return UIImpactFeedbackStyleRigid;
  }
  if ([name isEqualToString:@"soft"]) {
    return UIImpactFeedbackStyleSoft;
  }
  return UIImpactFeedbackStyleLight;
}

UINotificationFeedbackType NotificationTypeForName(NSString *name)
{
  if ([name isEqualToString:@"warning"]) {
    return UINotificationFeedbackTypeWarning;
  }
  if ([name isEqualToString:@"error"]) {
    return UINotificationFeedbackTypeError;
  }
  return UINotificationFeedbackTypeSuccess;
}

} // namespace

@interface WhimHapticsModule : NSObject <NativeWhimHapticsSpec>
@end

@implementation WhimHapticsModule {
  // One generator per impact style, kept so a prepared generator is the one that plays.
  NSMutableDictionary<NSNumber *, UIImpactFeedbackGenerator *> *_impacts;
  UISelectionFeedbackGenerator *_selection;
  UINotificationFeedbackGenerator *_notification;
}

+ (NSString *)moduleName
{
  return @"WhimHaptics";
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

// UIFeedbackGenerator is main-thread only: every method of this module runs there.
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    _impacts = [NSMutableDictionary new];
  }
  return self;
}

- (UIImpactFeedbackGenerator *)impactGenerator:(UIImpactFeedbackStyle)style
{
  NSNumber *key = @(style);
  UIImpactFeedbackGenerator *generator = _impacts[key];
  if (generator == nil) {
    generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:style];
    _impacts[key] = generator;
  }
  return generator;
}

- (UISelectionFeedbackGenerator *)selectionGenerator
{
  if (_selection == nil) {
    _selection = [UISelectionFeedbackGenerator new];
  }
  return _selection;
}

- (UINotificationFeedbackGenerator *)notificationGenerator
{
  if (_notification == nil) {
    _notification = [UINotificationFeedbackGenerator new];
  }
  return _notification;
}

- (void)impact:(NSString *)style intensity:(double)intensity android:(NSString *)android
{
  CGFloat clamped = (CGFloat)fmax(0.0, fmin(1.0, intensity));
  [[self impactGenerator:ImpactStyleForName(style)] impactOccurredWithIntensity:clamped];
}

- (void)selection:(NSString *)android
{
  [[self selectionGenerator] selectionChanged];
}

- (void)notification:(NSString *)kind android:(NSString *)android
{
  [[self notificationGenerator] notificationOccurred:NotificationTypeForName(kind)];
}

- (void)prepare:(NSString *)kind
{
  if ([kind isEqualToString:@"selection"]) {
    [[self selectionGenerator] prepare];
  } else if ([kind isEqualToString:@"notification"]) {
    [[self notificationGenerator] prepare];
  } else {
    [[self impactGenerator:ImpactStyleForName(kind)] prepare];
  }
}

- (void)cue:(NSString *)kind
{
  if ([kind isEqualToString:@"heavy"]) {
    [[self impactGenerator:UIImpactFeedbackStyleHeavy] impactOccurred];
    return;
  }
  UIImpactFeedbackGenerator *light = [self impactGenerator:UIImpactFeedbackStyleLight];
  [light impactOccurred];
  if ([kind isEqualToString:@"double"]) {
    [light prepare];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kDoubleGapNanoseconds), dispatch_get_main_queue(), ^{
      [light impactOccurred];
    });
  }
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeWhimHapticsSpecJSI>(params);
}

@end
