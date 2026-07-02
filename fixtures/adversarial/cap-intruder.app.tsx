// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY ADVERSARIAL FIXTURE — the CAPABILITY INTRUDER (capability-bridge task 4.4).
//
// A mini-app in the normal contract shape that declares NO capabilities and then tries to
// reach storage anyway, three ways:
//   1. Call the SDK storage facade — the gate must DENY it before any handler runs, with a
//      structured `undeclared_capability` error (the host-held manifest, not the bundle's
//      self-claim, is what gates).
//   2. Post a RAW forged syscall frame carrying cross-app addressing fields (appId/dbPath) —
//      the extra fields must be inert (identity is channel-derived; the host gates against THIS
//      realm's bound store, so no other app's data is reachable).
//   3. Post a forged `sysret` into its OWN window — must be inert (the marshaller accepts a
//      response only from the host channel, ev.source === window.parent; a self-post is not).
//
// It reports each outcome on-screen. A real §8.1 static check would flag the raw postMessage
// pokes; the pen test delivers it raw to exercise the live bridge gate. NOT a happy-path target.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text, useState, useEffect, storage } from 'vc-sdk';

const w: any = globalThis as any;

interface Line { label: string; result: string; }

function Home() {
  const [lines, setLines] = useState<Line[]>([]);
  const push = (label: string, result: string) =>
    setLines((ls) => ls.concat([{ label, result }]));

  useEffect(() => {
    // 1. undeclared-capability storage call.
    storage.kv.set('intrude', 'should-be-denied').then(
      () => push('storage.kv.set (no cap declared)', '⚠ NOT DENIED — wrote without declaring storage!'),
      (e: any) => push('storage.kv.set (no cap declared)', '✓ denied: ' + (e?.detail?.kind ? e.detail.kind : 'rejected')),
    );

    // 2. raw forged syscall with cross-app addressing fields — must have no effect.
    try {
      w.parent.postMessage(JSON.stringify({
        whim: 'syscall', v: 1, id: 990001, gen: 1,
        method: 'storage.kv.set',
        params: { key: 'x', value: 'cross-app' },
        appId: 'water-counter', dbPath: 'storage/water-counter.db', // forged — must be ignored
      }), '*');
      push('forged cross-app frame', '↗ posted (host ignores appId/dbPath; gated as cap-intruder → still no storage cap)');
    } catch (e: any) {
      push('forged cross-app frame', 'post threw (' + e?.name + ')');
    }

    // 3. forged sysret into our OWN window — inert (ev.source !== window.parent).
    try {
      w.postMessage(JSON.stringify({ whim: 'sysret', v: 1, id: 990001, ok: true, result: { value: 'attacker' } }), '*');
      push('forged self sysret', '↩ posted to self (host-channel-only acceptance → inert)');
    } catch (e: any) {
      push('forged self sysret', 'post threw (' + e?.name + ')');
    }
  }, []);

  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">CAP INTRUDER — bridge pen test</Heading>
        <Text size="caption" color="text-muted">declares no capabilities; ✓ = attack denied/inert</Text>
        {lines.map((l) => (
          <Text key={l.label} size="caption">{l.label}: {l.result}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Cap Intruder', initial: 'Home', screens: { Home }, capabilities: [] });
