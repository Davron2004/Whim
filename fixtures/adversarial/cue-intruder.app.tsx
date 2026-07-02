// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT FIXTURE — the CUE INTRUDER (effects-and-cues INV-CUEGATE, runtime-owner).
//
// The cue analogue of `cap-intruder` (the storage gate pen test), in the normal contract shape.
// It tries to fire physical cues (haptic/sound) it is NOT entitled to, four ways, and reports
// each outcome on-screen. The AUTHORITATIVE verdict is the trusted vantage: the host-side
// recording-fake CueBackend must log ZERO invocations, and the gate must answer each attack with
// a STRUCTURED denial — never a fired buzz/beep, never an unshaped throw.
//
//   1. `cues.haptic('double')` with a VALID token — denied iff the host-held manifest lacks
//      `cues` (the gate reads the host manifest, not the bundle's self-claim). Run undeclared,
//      this is `undeclared_capability`; the backend is never reached.
//   2. `cues.sound('chime')` with a VALID token — same gate, the second row.
//   3. `cues.sound('siren')` with an OFF-SET token (not in the closed {tick,chime,alarm} set) —
//      when the manifest DOES grant `cues` (the off-set scenario), this clears the capability
//      gate and is rejected `invalid_params`, the hint listing the valid tokens. The backend is
//      still never reached (params are checked before the handler runs).
//   4. A FORGED self-posted `sysret` — posting a fake ok cue-result into our OWN window must be
//      inert (the marshaller accepts a sysret only from the host channel, ev.source ===
//      window.parent). It must not resolve a stub or fire anything.
//
// A real §8.1 static check would flag the raw postMessage poke; the pen test delivers it raw to
// exercise the live cue gate + forged-sysret inertness end-to-end. NOT a happy-path build target.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text, useState, useEffect, cues } from 'vc-sdk';

const w: any = globalThis as any;

interface Line { label: string; result: string; }

function denialKind(e: any): string {
  // The marshaller rejects with an Error carrying `.detail` = the structured BridgeError/StorageError.
  return e?.detail?.kind ? e.detail.kind : 'rejected(no-kind)';
}

function Home() {
  const [lines, setLines] = useState<Line[]>([]);
  const push = (label: string, result: string) => setLines((ls) => ls.concat([{ label, result }]));

  useEffect(() => {
    // 1. valid-token haptic — gated on the host manifest (denied when `cues` undeclared).
    (cues.haptic as (k: any) => Promise<void>)('double').then(
      () => push('cues.haptic(double)', '⚠ NOT DENIED — fired without entitlement!'),
      (e: any) => push('cues.haptic(double)', '✓ denied: ' + denialKind(e)),
    );

    // 2. valid-token sound — the second cue row, same gate.
    (cues.sound as (n: any) => Promise<void>)('chime').then(
      () => push('cues.sound(chime)', '⚠ NOT DENIED — fired without entitlement!'),
      (e: any) => push('cues.sound(chime)', '✓ denied: ' + denialKind(e)),
    );

    // 3. OFF-SET token — not in the closed sound set; rejected invalid_params once `cues` is
    //    granted (else it is denied at the capability gate first — both are structured denials).
    (cues.sound as (n: any) => Promise<void>)('siren' as any).then(
      () => push('cues.sound(siren) [off-set]', '⚠ NOT DENIED — off-set token accepted!'),
      (e: any) => push('cues.sound(siren) [off-set]', '✓ denied: ' + denialKind(e)),
    );

    // 4. forged self sysret into our OWN window — inert (ev.source !== window.parent).
    try {
      w.postMessage(JSON.stringify({ whim: 'sysret', v: 1, id: 770001, ok: true, result: {} }), '*');
      push('forged self sysret', '↩ posted to self (host-channel-only acceptance → inert)');
    } catch (e: any) {
      push('forged self sysret', 'post threw (' + e?.name + ')');
    }
  }, []);

  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">CUE INTRUDER — cue gate pen test</Heading>
        <Text size="caption" color="text-muted">tries to buzz/beep without entitlement; ✓ = attack denied/inert</Text>
        {lines.map((l) => (
          <Text key={l.label} size="caption">{l.label}: {l.result}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Cue Intruder', initial: 'Home', screens: { Home }, capabilities: [] });
