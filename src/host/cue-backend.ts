// ─────────────────────────────────────────────────────────────────────────────
// cue-backend — the RN host implementation of the bridge `CueBackend` (effects-and-cues D5/D6).
// ─────────────────────────────────────────────────────────────────────────────
// This is the ONE place React Native APIs meet the cue contract. It is imported only host-side
// (`useMiniAppHost` injects it into `createDefaultRegistry`), NEVER by `src/host/bridge/*` — the
// bridge rows bind to the pure `CueBackend` interface so they stay loadable under Node (the
// deterministic suites). Each platform's native module owns its token→effect table: haptics in
// `WhimHaptics` (system.md §5: `tap` a light impact / `EFFECT_CLICK`, `double` two light impacts
// 80 ms apart / `EFFECT_DOUBLE_CLICK`, `heavy` a heavy impact / `EFFECT_HEAVY_CLICK`), sound in
// `WhimTone`. The syscall contract exposes only the closed tokens, so those tables can be tuned
// for on-device feel without touching the contract (D4 swappability).
import type { CueBackend, HapticKind, RealmRecord, SoundName } from './bridge/contract';
import WhimHaptics, { type Spec as HapticsModule } from '../native/NativeWhimHaptics';
import WhimTone from '../native/NativeWhimTone';
import { log } from './logging';
import { CHANNELS } from './logging/channels';

/** Haptic cues one realm may play per second, sustained (mini-app-cues "Haptic cues are
 *  rate-capped host-side"). */
export const HAPTIC_CUES_PER_SECOND = 10;
/** Haptic cues one realm may play back to back before the per-second rate applies. */
export const HAPTIC_CUE_BURST = 3;

interface Bucket {
  tokens: number;
  at: number;
}

/**
 * A per-realm token bucket: each realm starts with `HAPTIC_CUE_BURST` tokens and regains
 * `HAPTIC_CUES_PER_SECOND` a second, up to the burst. `take` spends one token and says whether
 * the cue may play; an empty bucket drops the cue (never queues it). It runs inside the
 * `cues.haptic` handler, so the dispatcher's at-most-once dedupe has already absorbed retries.
 */
function hapticRateCap(now: () => number): (realm: RealmRecord) => boolean {
  const buckets = new WeakMap<RealmRecord, Bucket>();
  return (realm) => {
    const t = now();
    const bucket = buckets.get(realm) ?? { tokens: HAPTIC_CUE_BURST, at: t };
    const elapsed = Math.max(0, t - bucket.at) / 1000;
    bucket.tokens = Math.min(HAPTIC_CUE_BURST, bucket.tokens + elapsed * HAPTIC_CUES_PER_SECOND);
    bucket.at = t;
    buckets.set(realm, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}

interface CueBackendOptions {
  /** The haptics module; defaults to the installed `WhimHaptics` (null on a build without it). */
  haptics?: HapticsModule | null;
  /** The clock the rate cap reads, in ms. */
  now?: () => number;
}

/**
 * Build the host cue backend. Haptics ride the in-repo `WhimHaptics` TurboModule (design-system-v1
 * D11), capped per realm; sound rides the in-repo `WhimTone` TurboModule. Both are fire-and-forget
 * and defensively wrapped: a cue must NEVER crash the host (D7 — cues add zero surface, including
 * no failure surface the bundle can observe), and a dropped haptic resolves exactly like a played
 * one. Both modules are resolved non-enforcingly, so a build without one degrades that cue to a
 * silent no-op rather than throwing at import.
 */
export function createCueBackend({ haptics = WhimHaptics, now = Date.now }: CueBackendOptions = {}): CueBackend {
  const mayPlay = hapticRateCap(now);
  return {
    haptic(kind: HapticKind, realm: RealmRecord): void {
      if (!mayPlay(realm)) return;
      try {
        haptics?.cue(kind);
      } catch (e) {
        // Still fire-and-forget: the failure NEVER reaches the bundle (D7 — a cue adds no failure
        // surface). It reaches the developer's log instead of nowhere.
        log.debug(CHANNELS.app, 'haptic cue failed', {
          cue: kind,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    },
    sound(name: SoundName): void {
      try {
        // Each platform's native module owns its own token→tone+duration table (host-side, D6);
        // we pass the closed token straight through. Null when the native module isn't present
        // (e.g. a codegen-less dev build) → sound is a no-op.
        WhimTone?.play(name);
      } catch (e) {
        log.debug(CHANNELS.app, 'sound cue failed', {
          cue: name,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
}
