// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT FIXTURE — the TIMER TICKER (effects-and-cues INV-TIMER, runtime-owner).
//
// A benign mini-app whose only job is to make an SDK `interval` OBSERVABLE FROM THE TRUSTED
// VANTAGE. It does NOT test anything itself (F4 — never the bundle's self-report); the verdict
// is computed by the parent page, which collects the tick frames this fixture posts over the
// one-way transport and reasons about them by wall-clock + generation.
//
// Mechanism: on mount it starts a fast `interval`; each tick posts a
//   { __whimUiEvent:true, type:'press', label:'timertick:<n>' }
// frame through `ReactNativeWebView.postMessage` — the loader's transport stub (the single
// permitted crossing, constraint #2), the SAME pipe a Button press rides. The outer page relays
// it and logs `UI-EVENT press timertick:<n>`, which the suite reads with a wall-clock timestamp.
// The fixture makes NO generation claim of its own (F4 — never trust the bundle's self-report):
// the parent owns the reset boundary and classifies ticks purely by arrival time.
//
// The INV-TIMER claim ("a gen-1 interval never ticks into gen-2"): the host lets gen-1 tick, then
// RESETS the realm (iframe recreation, carry-forward #5) and delivers a DIFFERENT, SILENT bundle
// as gen-2. Destroying the browsing context destroys gen-1's timer queue (design D2, structural
// cancellation), so the parent observes ZERO `timertick` frames past the reset boundary — any
// that arrived would be a surviving gen-1 timer, since gen-2 never ticks. Non-vacuity: a control
// re-injection WITHOUT a reset (same realm) keeps the ticks coming, proving the detector is live
// and the silence after a reset is teardown, not a dead realm.
//
// A real §8.1 static check would flag the raw postMessage; the invariant delivers it raw to
// exercise the live timer-teardown seam. NOT a happy-path build target.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text, useState, interval } from 'vc-sdk';

const w: any = globalThis as any;

// Post a tick to the parent over the one-way transport stub (the loader's
// `ReactNativeWebView.postMessage` → `parent.postMessage`). Best-effort, fire-and-forget — the
// SAME crossing the SDK's Button uses; it grants the bundle nothing back.
function emitTick(n: number): void {
  try {
    const rnww = w.ReactNativeWebView;
    if (rnww && typeof rnww.postMessage === 'function') {
      rnww.postMessage(JSON.stringify({ __whimUiEvent: true, type: 'press', label: 'timertick:' + n }));
    }
  } catch {
    return; // one-way, best-effort
  }
}

function Ticker() {
  const [n, setN] = useState(0);

  // A FAST interval (40 ms) so several ticks land per phase. Auto-cleanup on unmount and realm
  // teardown is the whole point (design D1/D2) — there is no cleanup written here, and after the
  // host recreates the iframe this interval's browsing context (and its timer queue) is gone.
  interval(() => {
    const next = n + 1;
    setN(next);
    emitTick(next);
  }, 40);

  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">TIMER TICKER — INV-TIMER</Heading>
        <Text size="caption" color="text-muted">ticks observed by the parent (trusted vantage owns the boundary)</Text>
        <Text size="display" color="primary">{String(n)}</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Timer Ticker', initial: 'Ticker', screens: { Ticker }, capabilities: [] });
