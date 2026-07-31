// ─────────────────────────────────────────────────────────────────────────────
// tier-a acceptance fixture — the honest candidate (`evals/test/tier-a.test.ts`). No forbidden
// globals, no disallowed imports, one screen that matches `initial` — the static leg produces
// zero diagnostics, so the fixture pins Tier A's pass path.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp } from 'vc-sdk';

function Home() {
  return null;
}

export default defineApp({
  name: 'Honest Case',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
});
