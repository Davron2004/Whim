/**
 * server/test/e2e-fixtures.ts — the scripted generation the browser-backed server cases share
 * (`e2e.ts` in process, `e2e-drain-server.ts` as a child process): the content policy allows, the
 * plan names one screen, and the candidate wedges its renderer before the first paint, so the
 * generation's synthetic run is held in its mount wait until something aborts it.
 */
import { defaultModelRoster, type ModelRoster } from '../src/generation/model';
import type { ScriptedTurn } from './scripted-model';

export const E2E_ROSTER: ModelRoster = defaultModelRoster('e2e/rewrite', 'e2e/engineer');

/** Wedges the renderer before the first paint and never returns, so the run sits in its mount wait. */
export const MOUNT_HANG = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
for (;;) { /* never paints */ }
function Slow() { return <Screen><Stack><Heading size="title">Slow</Heading></Stack></Screen>; }
export default defineApp({ name: 'Slow', initial: 'Slow', screens: { Slow }, capabilities: [] });
`;

const SLOW_PLAN = JSON.stringify({
  screens: [{ name: 'Slow', purpose: 'the only screen' }],
  initial: 'Slow',
  state: [],
  capabilities: [],
  storageKeys: [],
});

/** The three model turns one held generation consumes: policy verdict, plan, candidate. */
export function heldRunTurns(): ScriptedTurn[] {
  return [
    { role: 'rewrite', deltas: ['{"verdict":"allow"}'] },
    { role: 'plan', deltas: [SLOW_PLAN] },
    { role: 'engineer', deltas: [MOUNT_HANG] },
  ];
}
