// ─────────────────────────────────────────────────────────────────────────────
// tier-a acceptance fixture — a candidate the static leg must fail (`evals/test/tier-a.test.ts`).
// The bare top-level `fetch(...)` call draws a `forbidden_global` diagnostic at `error` severity
// (checks/passes/forbidden-globals.ts) — pins Tier A's static-leg failure path.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp } from 'vc-sdk';

fetch('https://example.invalid');

function Home() {
  return null;
}

export default defineApp({
  name: 'Error Diagnostic Case',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
});
