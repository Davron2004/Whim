/**
 * consent-flow Node suite (task 3.3) — locks ai-data-consent spec "The first action that would
 * send data asks for consent at that moment" and "Permission is explicit and declining keeps
 * installed apps usable", for every gated entry point: the home composer row, "Prompt again", the
 * orb's change action, history's "Change it from here" (all `compose` continuations, with or
 * without an app being edited), and Retry on a failed/interrupted build (`retry`).
 */

import { Harness } from './harness';
import { consentControls, declineTarget, entryDecision } from '../consent-flow';
import type { ConsentContinuation, ConsentControl } from '../consent-flow';
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

  // consentControls (design D6): every one of the three consent-screen states offers exactly one
  // `close` control (the non-granting exit an iOS reviewer needs when there is no hardware back),
  // and it never grants or revokes.
  const STATES: ReadonlyArray<{ name: string; mode: 'ask' | 'review'; consentOn: boolean }> = [
    { name: 'ask', mode: 'ask', consentOn: false },
    { name: 'review, on', mode: 'review', consentOn: true },
    { name: 'review, off', mode: 'review', consentOn: false },
  ];

  for (const { name, mode, consentOn } of STATES) {
    await h.test(`consentControls: ${name} has exactly one non-granting close control`, () => {
      const { primary, plain } = consentControls(mode, consentOn);
      const closes = [primary, plain].filter((c) => c.action === 'close');
      h.eq(closes.length, 1, `${name} offers exactly one close control, so it is always leavable without a grant`);
    });
  }

  await h.test('consentControls: review, on — the primary IS the close control (Keep AI features on)', () => {
    const { primary, plain } = consentControls('review', true);
    const expectedPrimary: ConsentControl = { action: 'close', label: 'consentReviewKeepOn' };
    const expectedPlain: ConsentControl = { action: 'turn-off', label: 'consentReviewTurnOff' };
    h.eq(primary, expectedPrimary, 'review-on’s safe, primary action is the same as leaving');
    h.eq(plain, expectedPlain, 'review-on’s plain action turns AI features off');
  });

  await h.test('consentControls: review, off — the plain action is close, labelled consentDecline', () => {
    const { primary, plain } = consentControls('review', false);
    const expectedPrimary: ConsentControl = { action: 'agree', label: 'consentReviewTurnOn' };
    const expectedPlain: ConsentControl = { action: 'close', label: 'consentDecline' };
    h.eq(primary, expectedPrimary, 'review-off’s primary action turns AI features on');
    h.eq(plain, expectedPlain, 'review-off’s plain action is a non-granting close, labelled consentDecline');
  });

  await h.test('consentControls: ask — labelled consentAgree and consentDecline', () => {
    const { primary, plain } = consentControls('ask', false);
    const expectedPrimary: ConsentControl = { action: 'agree', label: 'consentAgree' };
    const expectedPlain: ConsentControl = { action: 'close', label: 'consentDecline' };
    h.eq(primary, expectedPrimary, 'ask’s primary action agrees');
    h.eq(plain, expectedPlain, 'ask’s plain action declines');
  });
}
