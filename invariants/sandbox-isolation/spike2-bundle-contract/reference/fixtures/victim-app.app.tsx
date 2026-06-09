// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY SPIKE — PEN-TEST T7 fixture: the VICTIM (re-injection generation 2).
//
// A clean, benign mini-app re-injected into the SAME iframe realm AFTER the poisoner
// (poison-app.app.tsx, generation 1). It does NOT plant anything and does NOT itself test
// anything — the AUTHORITATIVE T7 verdict comes from the TRUSTED victim probe in
// web/probes.js (which runs in the loader scope after THIS bundle mounts, so a malicious
// generation-1 bundle cannot tamper with the verdict — finding F4). This app exists only to
// (a) trigger that trusted probe again in the re-injected realm, and (b) render a quick
// human-readable readout of whether generation 1's pollution is visible to it.
//
// If the realm was reset between generations (re-create the iframe, or re-strip/re-freeze),
// the readout below shows NO poison. If channel (b) re-injects into the SAME un-reset realm
// (the spike loader's behavior, and the Spike-8 hot-reload shape), the readout shows the
// poison PERSISTED → the T7 finding → the Spike-8 constraint. NOT a happy-path build target.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text } from 'vc-sdk';

const w: any = globalThis as any;

function observe(): string[] {
  const out: string[] = [];
  const backdoor = typeof w.__WHIM_T7_BACKDOOR === 'function';
  let proto = false;
  try { proto = ({} as any).__whimPwned === 'pwned-by-generation-1'; } catch (e) {}
  const flag = w.__WHIM_T7_GLOBAL_FLAG === 'set-by-generation-1';
  out.push('backdoor visible: ' + backdoor);
  out.push('Object.prototype.__whimPwned visible: ' + proto);
  out.push('global flag visible: ' + flag);
  out.push((backdoor || proto || flag)
    ? '⚠ generation-1 pollution PERSISTED into this re-injected generation'
    : '✓ realm appears clean (no generation-1 pollution)');
  return out;
}

const OBSERVED = observe();

function Home() {
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">VICTIM APP — T7 generation 2</Heading>
        <Text size="caption" color="text-muted">re-injected into the same iframe; trusted probe holds the real verdict</Text>
        {OBSERVED.map((r, i) => (
          <Text key={i} size="caption">{r}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Victim App', initial: 'Home', screens: { Home }, capabilities: [] });
