// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY SPIKE — PEN-TEST T7 fixture: the POISONER (re-injection generation 1).
//
// A malicious mini-app in the normal contract shape. Its job is to leave PERSISTENT
// pollution in the iframe realm that a LATER re-injected generation (generation 2) would
// inherit, IF channel (b) re-injects into the same realm without resetting it. It plants
// three markers the TRUSTED victim probe (web/probes.js, T7 section) looks for:
//   • window.__WHIM_T7_BACKDOOR     — a leftover backdoor function on the global
//   • Object.prototype.__whimPwned  — prototype pollution (every {} inherits it)
//   • window.__WHIM_T7_GLOBAL_FLAG  — a mutated shared global
//
// Marker names/values MUST stay in sync with the T7 section of web/probes.js.
//
// This poisoning is NOT a sandbox ESCAPE (no network/codegen/native reach — the realm is
// still fully contained). It is a SAME-REALM PERSISTENCE hazard: the question T7 answers is
// whether generation N can poison generation N+1 across a re-injection. A real §8.1 static
// check would REJECT this (it touches window/document/Object.prototype); the pen test
// delivers it raw to probe the RUNTIME re-injection behavior. NOT a happy-path build target.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text } from 'vc-sdk';

const w: any = globalThis as any;

function planted(): string[] {
  const log: string[] = [];

  // 1. backdoor function left on the global
  try {
    w.__WHIM_T7_BACKDOOR = function () { return 'backdoor reachable from a later generation'; };
    log.push('backdoor: planted window.__WHIM_T7_BACKDOOR');
  } catch (e: any) { log.push('backdoor: blocked (' + (e && e.name) + ')'); }

  // 2. prototype pollution — every object in a later generation inherits this.
  // NOTE: planted NON-ENUMERABLE on purpose. An *enumerable* `Object.prototype.__whimPwned`
  // additionally CRASHES the next generation's bundle init — esbuild's `__export` helper does
  // `for (k in all) __defProp(target, k, { get: all[k] })`, so the inherited enumerable key
  // makes it try to install the string value as a getter → "Getter must be a function". That
  // is an even harsher T7 result (gen-1 can DoS gen-N+1), but it stops gen-2 from running so
  // the victim probe can't confirm inheritance. Non-enumerable lets gen-2 load AND inherit the
  // marker, so the trusted probe can prove persistence directly. Both variants prove the
  // finding; we use the one that yields the cleaner gen-2 confirmation.
  try {
    Object.defineProperty(Object.prototype, '__whimPwned', {
      value: 'pwned-by-generation-1', enumerable: false, configurable: true, writable: true,
    });
    log.push('proto: planted Object.prototype.__whimPwned (non-enumerable; enumerable would also DoS gen-2 bundle init)');
  } catch (e: any) { log.push('proto: blocked (' + (e && e.name) + ')'); }

  // 3. a mutated shared global flag
  try {
    w.__WHIM_T7_GLOBAL_FLAG = 'set-by-generation-1';
    log.push('global: set window.__WHIM_T7_GLOBAL_FLAG');
  } catch (e: any) { log.push('global: blocked (' + (e && e.name) + ')'); }

  return log;
}

const PLANTED = planted();

function Home() {
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">POISON APP — T7 generation 1</Heading>
        <Text size="caption" color="text-muted">plants persistent pollution; re-inject the victim app next</Text>
        {PLANTED.map((r, i) => (
          <Text key={i} size="caption">{r}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Poison App', initial: 'Home', screens: { Home }, capabilities: [] });
