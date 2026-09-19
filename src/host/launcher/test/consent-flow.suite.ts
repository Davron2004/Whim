/**
 * consent-flow Node suite (task 3.3) — locks ai-data-consent spec "The first action that would
 * send data asks for consent at that moment" and "Permission is explicit and declining keeps
 * installed apps usable", for every gated entry point: the home composer row, "Prompt again", the
 * orb's change action, history's "Change it from here" (all `compose` continuations, with or
 * without an app being edited), and Retry on a failed/interrupted build (`retry`).
 */

import { Harness } from './harness';
import { declineTarget, entryDecision } from '../consent-flow';
import type { ConsentContinuation } from '../consent-flow';
import type { ConsentStatus } from '../ai-consent';
import type { InstalledApp } from '../app-index';
import type { PendingBuildRecord } from '../pending-builds';

const GRANTED: ConsentStatus = { kind: 'granted', grantedAt: '2026-09-14T00:00:00.000Z' };
const ABSENT: ConsentStatus = { kind: 'absent' };
const OUTDATED: ConsentStatus = { kind: 'outdated' };

/** A minimal installed app — the same shape `grid-composition.suite.ts#app` already uses. */
function app(id: string, name = id): InstalledApp {
  return {
    id,
    name,
    createdAt: 1,
    record: { appId: id, name, manifest: { capabilities: [] } },
    lineageId: 'main',
  };
}

/** A minimal pending-build record — the same shape `grid-composition.suite.ts#pendingRecord`
 *  already uses. */
function pendingRecord(id: string): PendingBuildRecord {
  return {
    id,
    prompt: `prompt for ${id}`,
    workingTitle: `Title ${id}`,
    state: 'failed',
    createdAt: 1,
    updatedAt: 1,
  };
}

const WATER_COUNTER = app('water-counter', 'Water Counter');
const RETRY_RECORD = pendingRecord('run-1');

/** The five gated entry points, as their continuations (design D1). */
const ENTRY_POINTS: ReadonlyArray<{ name: string; continuation: ConsentContinuation }> = [
  { name: 'home composer row', continuation: { kind: 'compose' } },
  { name: '"Prompt again" (long-press)', continuation: { kind: 'compose', editing: WATER_COUNTER } },
  { name: "the orb's change action", continuation: { kind: 'compose', editing: WATER_COUNTER } },
  { name: 'history’s "Change it from here"', continuation: { kind: 'compose', editing: WATER_COUNTER } },
  { name: 'Retry on a failed/interrupted build', continuation: { kind: 'retry', record: RETRY_RECORD } },
];

export async function runConsentFlowTests(h: Harness): Promise<void> {
  for (const { name, continuation } of ENTRY_POINTS) {
    await h.test(`entryDecision: ${name} continues immediately when consent is granted`, () => {
      h.eq(entryDecision(GRANTED, continuation), { kind: 'continue' }, `${name} runs its continuation with a current grant`);
    });

    await h.test(`entryDecision: ${name} asks first with no consent grant`, () => {
      h.eq(
        entryDecision(ABSENT, continuation),
        { kind: 'ask', continuation },
        `${name} opens the consent screen, carrying its own continuation, when consent is absent`,
      );
    });

    await h.test(`entryDecision: ${name} asks first when the stored grant is outdated`, () => {
      h.eq(
        entryDecision(OUTDATED, continuation),
        { kind: 'ask', continuation },
        `${name} opens the consent screen — an outdated grant is never treated as current`,
      );
    });
  }

  await h.test('declineTarget: a running mini-app never resumes — Home instead', () => {
    h.eq(declineTarget({ kind: 'app', appId: WATER_COUNTER.id }), { kind: 'home' }, 'a torn-down realm is never resumed');
  });

  await h.test('declineTarget: every other screen returns to itself, unchanged', () => {
    const cases: Array<Record<string, unknown>> = [
      { kind: 'home' },
      { kind: 'history', app: WATER_COUNTER },
      { kind: 'failure', reason: 'it did not build' },
      { kind: 'settings' },
    ];
    for (const screen of cases) {
      h.eq(declineTarget(screen), screen, `${screen.kind} is returned to as-is, with its own fields intact`);
    }
  });
}
