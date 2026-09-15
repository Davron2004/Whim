// ─────────────────────────────────────────────────────────────────────────────
// WhimToneModule — the iOS half of the cross-platform WhimTone TurboModule
// (platform-release-readiness design D9; mini-app-cues "Sound cues play on iOS from the Android
// tone table"). Renders the same three closed sound tokens the Android
// `android.media.ToneGenerator` implementation plays (`src/native/NativeWhimTone.ts`,
// `android/app/src/main/java/com/whim/tone/WhimToneModule.kt`), cut to Android's play windows,
// and plays them as iOS system sounds. Fire-and-forget (mini-app-cues "Cue delivery is
// fire-and-forget and at-most-once" / D7): `play:` never throws back to JS, resolves before any
// synthesis or playback happens, and every failure is swallowed — a cue must never crash the
// host or surface an error the bundle can react to.
// ─────────────────────────────────────────────────────────────────────────────
#import <WhimAppSpecs/WhimAppSpecs.h>
#import <AudioToolbox/AudioToolbox.h>

#include <cmath>
#include <cstdint>
#include <vector>

using namespace facebook::react;

namespace {

constexpr double kSampleRate = 44100.0;
constexpr double kRampSeconds = 0.003; // 3 ms linear ramp per burst (design D9)
constexpr double kToneGainBase = 0.9; // ToneGenerator's per-wave gain
constexpr double kVolumeDb = -5.0; // Java volume 90 mapped to dB (design D9)

struct Burst {
  double startSeconds;
  double durationSeconds;
  std::vector<double> frequenciesHz;
};

struct ToneSpec {
  double totalSeconds;
  std::vector<Burst> bursts;
};

// Tone table (design D9), cut to Android's play windows: `chime`'s second ToneGenerator burst
// starts at 200 ms, past its 180 ms window, so it never sounds on Android either — iOS renders
// exactly one burst per token render, matching what's actually audible.
ToneSpec ToneSpecForResolvedToken(NSString *token)
{
  if ([token isEqualToString:@"chime"]) {
    return ToneSpec{0.100, {Burst{0.0, 0.100, {1200.0}}}};
  }
  if ([token isEqualToString:@"alarm"]) {
    return ToneSpec{
        0.625,
        {
            Burst{0.000, 0.125, {1319.0}},
            Burst{0.250, 0.125, {1319.0}},
            Burst{0.500, 0.125, {1319.0}},
        }};
  }
  // 'tick' and every unknown token fall back to the same dual-tone render (spec "An unknown
  // token falls back").
  return ToneSpec{0.040, {Burst{0.0, 0.040, {400.0, 1200.0}}}};
}

// Unknown tokens play as `tick` (spec "Sound cues play on iOS from the Android tone table"); this
// also picks the cache key and file name so the closed token set maps onto exactly three files.
NSString *ResolveToken(NSString *token)
{
  if ([token isEqualToString:@"chime"] || [token isEqualToString:@"alarm"]) {
    return token;
  }
  return @"tick";
}

// Minimal RIFF/WAV writer (PCM, mono, 16-bit, 44.1 kHz) around a synthesized tone. Each sample is
// `(0.9 / waveCount) × 10^(−5/20) × Σ sin(2πft)` (design D9 — ToneGenerator's per-wave gain at
// Java volume 90), shaped by a 3 ms linear ramp in and out of every burst to avoid speaker
// clicks (ToneGenerator has no ramp; this deviation is deliberate).
NSData *RenderToneWav(const ToneSpec &spec)
{
  const auto frameCount = static_cast<size_t>(std::llround(spec.totalSeconds * kSampleRate));
  std::vector<int16_t> samples(frameCount, 0);
  const double linearGain = std::pow(10.0, kVolumeDb / 20.0);
  const auto rampFrames = static_cast<size_t>(std::llround(kRampSeconds * kSampleRate));

  for (const Burst &burst : spec.bursts) {
    const auto startFrame = static_cast<size_t>(std::llround(burst.startSeconds * kSampleRate));
    const auto burstFrames =
        static_cast<size_t>(std::llround(burst.durationSeconds * kSampleRate));
    const double waveCount = static_cast<double>(burst.frequenciesHz.size());
    const double amplitude = (kToneGainBase / waveCount) * linearGain;

    for (size_t i = 0; i < burstFrames && (startFrame + i) < frameCount; i++) {
      const double t = static_cast<double>(i) / kSampleRate;
      double value = 0.0;
      for (double freqHz : burst.frequenciesHz) {
        value += std::sin(2.0 * M_PI * freqHz * t);
      }
      value *= amplitude;

      double ramp = 1.0;
      if (i < rampFrames) {
        ramp = static_cast<double>(i) / static_cast<double>(rampFrames);
      } else if (i >= burstFrames - rampFrames) {
        ramp = static_cast<double>(burstFrames - i) / static_cast<double>(rampFrames);
      }
      value *= ramp;

      const double clamped = std::fmax(-1.0, std::fmin(1.0, value));
      samples[startFrame + i] = static_cast<int16_t>(std::llround(clamped * 32767.0));
    }
  }

  const uint32_t dataSize = static_cast<uint32_t>(samples.size() * sizeof(int16_t));
  const uint32_t sampleRate32 = static_cast<uint32_t>(kSampleRate);
  const uint32_t byteRate = sampleRate32 * 2;
  const uint32_t riffChunkSize = 36 + dataSize;
  const uint32_t fmtChunkSize = 16;
  const uint16_t audioFormatPcm = 1;
  const uint16_t numChannels = 1;
  const uint16_t blockAlign = 2;
  const uint16_t bitsPerSample = 16;

  NSMutableData *wav = [NSMutableData data];
  [wav appendBytes:"RIFF" length:4];
  [wav appendBytes:&riffChunkSize length:4];
  [wav appendBytes:"WAVE" length:4];
  [wav appendBytes:"fmt " length:4];
  [wav appendBytes:&fmtChunkSize length:4];
  [wav appendBytes:&audioFormatPcm length:2];
  [wav appendBytes:&numChannels length:2];
  [wav appendBytes:&sampleRate32 length:4];
  [wav appendBytes:&byteRate length:4];
  [wav appendBytes:&blockAlign length:2];
  [wav appendBytes:&bitsPerSample length:2];
  [wav appendBytes:"data" length:4];
  [wav appendBytes:&dataSize length:4];
  if (dataSize > 0) {
    [wav appendBytes:samples.data() length:dataSize];
  }
  return wav;
}

} // namespace

@interface WhimToneModule : NSObject <NativeWhimToneSpec>
@end

@interface WhimToneModule ()
- (nullable NSURL *)cachedFileUrlForResolvedToken:(NSString *)resolvedToken;
@end

@implementation WhimToneModule {
  dispatch_queue_t _queue; // private serial queue: synthesis, file I/O and playback run off it
  NSMutableDictionary<NSString *, NSNumber *> *_soundIDsByToken; // resolved token -> SystemSoundID
}

+ (NSString *)moduleName
{
  return @"WhimTone";
}

- (instancetype)init
{
  if (self = [super init]) {
    _queue = dispatch_queue_create("com.whim.tone.WhimToneModule", DISPATCH_QUEUE_SERIAL);
    _soundIDsByToken = [NSMutableDictionary new];
  }
  return self;
}

- (void)play:(NSString *)token
{
  // Resolve and hop off the calling thread immediately: `play:` never blocks the JS thread, and
  // the syscall it backs resolves without waiting for playback (mini-app-cues "Cue delivery is
  // fire-and-forget and at-most-once").
  NSString *resolved = ResolveToken(token);
  __weak WhimToneModule *weakSelf = self;
  dispatch_async(_queue, ^{
    WhimToneModule *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return;
    }
    @try {
      NSNumber *cachedID = strongSelf->_soundIDsByToken[resolved];
      SystemSoundID soundID;
      if (cachedID != nil) {
        soundID = (SystemSoundID)cachedID.unsignedIntValue;
      } else {
        NSURL *fileURL = [strongSelf cachedFileUrlForResolvedToken:resolved];
        if (fileURL == nil) {
          return; // Every error is swallowed (design D9): no cue, no throw.
        }
        OSStatus status = AudioServicesCreateSystemSoundID((__bridge CFURLRef)fileURL, &soundID);
        if (status != kAudioServicesNoError) {
          return;
        }
        strongSelf->_soundIDsByToken[resolved] = @(soundID);
      }
      AudioServicesPlaySystemSound(soundID);
    } @catch (NSException *exception) {
      // Fire-and-forget: a cue must never crash the host or surface to JavaScript (design D9).
    }
  });
}

// Lazily renders and writes `<token>.wav` under `Caches/whim-tone-v1/` the first time a token is
// played, then reuses the file for every later call. Returns nil on any failure; the caller
// treats that as "no cue this time" rather than propagating an error.
- (nullable NSURL *)cachedFileUrlForResolvedToken:(NSString *)resolvedToken
{
  NSArray<NSString *> *cachesDirs =
      NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES);
  if (cachesDirs.count == 0) {
    return nil;
  }
  NSString *dir = [cachesDirs.firstObject stringByAppendingPathComponent:@"whim-tone-v1"];
  NSFileManager *fileManager = NSFileManager.defaultManager;
  NSError *error = nil;
  if (![fileManager createDirectoryAtPath:dir
               withIntermediateDirectories:YES
                                attributes:nil
                                     error:&error]) {
    return nil;
  }
  NSString *path = [dir stringByAppendingPathComponent:[resolvedToken stringByAppendingString:@".wav"]];
  if (![fileManager fileExistsAtPath:path]) {
    NSData *wav = RenderToneWav(ToneSpecForResolvedToken(resolvedToken));
    if (![wav writeToFile:path atomically:YES]) {
      return nil;
    }
  }
  return [NSURL fileURLWithPath:path];
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeWhimToneSpecJSI>(params);
}

@end
