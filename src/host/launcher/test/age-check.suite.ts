/**
 * age-check Node suite (legal-surface-v2 task 9.3; spec store-age-signals). Drives the module with
 * an injected native answer: each answer's outcome, what the key-value store holds afterwards (the
 * outcome and its date, never the signal), when the flow asks the store again, and where the age
 * steps sit in `nextLegalStep`.
 */

import { Harness } from './harness';
import { FakeTimers } from './fake-timers';
import { MapKVBackend } from '../../version-store';
import { runAgeCheck, storedAgeGate, type AgeCheckOptions, type AgeCheckResult } from '../age-check';
import { nextLegalStep } from '../consent-flow';
import type { TermsStatus } from '../terms-acceptance';
import type { ConsentStatus } from '../ai-consent';

const AGE_CHECK_KEY = 'whim.age-check:v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKED = new Date('2026-09-24T09:30:00.000Z');

/** A native call that neither resolves nor rejects. */
const neverSettles = (): Promise<unknown> => new Promise<unknown>(() => {});

/** Let every queued promise step run. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** Starts a check on fake timers without awaiting it: `result` fills in when the check ends, so a
 *  check that never ends fails its test by name instead of hanging the suite. */
function started(kv: MapKVBackend, read: () => Promise<unknown>, options: AgeCheckOptions) {
  const run: { result?: AgeCheckResult } = {};
  runAgeCheck(kv, read, () => CHECKED, options).then((result) => { run.result = result; });
  return run;
}

/** Runs one check against a fresh store with `answer` as the native module's reply. */
async function checkWith(answer: () => Promise<unknown>): Promise<{ kv: MapKVBackend; outcome: AgeCheckResult }> {
  const kv = new MapKVBackend();
  const outcome = await runAgeCheck(kv, answer, () => CHECKED);
  return { kv, outcome };
}

/** The record an age check left in `kv`. */
const storedRecord = (kv: MapKVBackend): Record<string, unknown> => JSON.parse(kv.getString(AGE_CHECK_KEY) ?? 'null');

/** A store holding an age check with this outcome, made `daysAgo` days before `CHECKED`. */
async function checkedDaysAgo(signal: string, daysAgo: number): Promise<MapKVBackend> {
  const kv = new MapKVBackend();
  await runAgeCheck(kv, () => Promise.resolve(signal), () => new Date(CHECKED.getTime() - daysAgo * DAY_MS));
  return kv;
}

const ACCEPTED: TermsStatus = { kind: 'accepted', version: 1, acceptedAt: '2026-09-01T00:00:00.000Z' };
const GRANTED: ConsentStatus = { kind: 'granted', version: 2, grantedAt: '2026-09-01T00:00:00.000Z' };

export async function runAgeCheckTests(h: Harness): Promise<void> {
  for (const [signal, result, stored] of [
    ['adult', 'allowed', 'allowed'],
    ['minor-approved', 'allowed', 'allowed'],
    ['unavailable', 'allowed', 'allowed'],
    ['minor-not-approved', 'minor-not-approved', 'blocked'],
    ['under-13', 'under-13', 'blocked'],
  ] as const) {
    await h.test(`age-check: a native "${signal}" answer is ${result}, stored as ${stored}`, async () => {
      const check = await checkWith(() => Promise.resolve(signal));
      h.eq(check.outcome, result, `${signal} -> ${result}`);
      h.eq(storedRecord(check.kv).outcome, stored, `${signal} is stored as ${stored}`);
    });
  }

  await h.test('age-check: a user under 13 is held, and the store keeps only "blocked" and its date', async () => {
    const { kv, outcome } = await checkWith(() => Promise.resolve('under-13'));
    h.eq(outcome, 'under-13', 'the check says why it held the user, for the message');
    h.eq(storedRecord(kv), { outcome: 'blocked', checkedAt: CHECKED.toISOString() }, 'exactly { outcome: blocked, checkedAt }');
    h.eq(storedAgeGate(kv, CHECKED), 'unchecked', 'and it is asked again at the next attempt, like any blocked outcome');
  });

  await h.test('age-check: no signal lets the user through — a rejected, throwing, missing or unknown answer is allowed', async () => {
    const answers: Record<string, () => Promise<unknown>> = {
      rejected: () => Promise.reject(new Error('Play services missing')),
      throws: () => { throw new Error('no module'); },
      missing: () => Promise.resolve(undefined),
      unknown: () => Promise.resolve('minor'),
      'an object': () => Promise.resolve({ userStatus: 'SUPERVISED_APPROVAL_DENIED' }),
    };
    for (const [name, answer] of Object.entries(answers)) {
      h.eq((await checkWith(answer)).outcome, 'allowed', `${name} counts as unavailable`);
    }
  });

  await h.test('age-check: a native call that never settles counts as unavailable after 3 seconds, so the user continues', async () => {
    const kv = new MapKVBackend();
    const timers = new FakeTimers();
    const run = started(kv, neverSettles, { timers });
    await flush();
    h.eq(run.result, undefined, 'the check is still waiting before the deadline');
    h.eq(timers.delays, [3000], 'bounded by one 3-second deadline');
    timers.fireOnly();
    await flush();
    h.eq(run.result, 'allowed', 'the deadline reads as unavailable, which continues');
    h.eq(storedRecord(kv), { outcome: 'allowed', checkedAt: CHECKED.toISOString() }, 'stored like any unavailable answer');
  });

  await h.test('age-check: an answer within 3 seconds is used unchanged and its deadline is cleared', async () => {
    const kv = new MapKVBackend();
    const timers = new FakeTimers();
    const run = started(kv, () => Promise.resolve('minor-not-approved'), { timers });
    await flush();
    h.eq(run.result, 'minor-not-approved', 'the answer is reduced exactly as before');
    h.eq(timers.pendingCount, 0, 'no deadline is left to fire');
  });

  await h.test('age-check: the store holds only the outcome and its date, never the signal', async () => {
    const { kv } = await checkWith(() => Promise.resolve('minor-approved'));
    h.eq(kv.getAllKeys(), [AGE_CHECK_KEY], 'the check writes one key');
    const stored = JSON.parse(kv.getString(AGE_CHECK_KEY) ?? 'null') as Record<string, unknown>;
    h.eq(stored, { outcome: 'allowed', checkedAt: CHECKED.toISOString() }, 'exactly { outcome, checkedAt }');
    h.ok(!(kv.getString(AGE_CHECK_KEY) ?? '').includes('minor'), 'the raw signal is not stored');
  });

  await h.test('age-check: a later check replaces the earlier outcome', async () => {
    const kv = await checkedDaysAgo('minor-not-approved', 1);
    await runAgeCheck(kv, () => Promise.resolve('minor-approved'), () => CHECKED);
    h.eq(storedAgeGate(kv, CHECKED), 'allowed', 'a parent’s approval takes effect at the next check');
  });

  await h.test('age-check: the flow asks again with no outcome, an outcome over 30 days old, or a blocked one', async () => {
    h.eq(storedAgeGate(new MapKVBackend(), CHECKED), 'unchecked', 'no outcome stored');
    h.eq(storedAgeGate(await checkedDaysAgo('adult', 29), CHECKED), 'allowed', 'an allowed outcome 29 days old holds');
    h.eq(storedAgeGate(await checkedDaysAgo('adult', 30), CHECKED), 'allowed', 'and still at exactly 30 days');
    h.eq(storedAgeGate(await checkedDaysAgo('adult', 31), CHECKED), 'unchecked', 'one 31 days old does not');
    h.eq(storedAgeGate(await checkedDaysAgo('minor-not-approved', 0), CHECKED), 'unchecked', 'a blocked outcome is asked again at once');
    h.eq(storedAgeGate(await checkedDaysAgo('adult', -1), CHECKED), 'unchecked', 'an outcome dated after now (a moved clock) is asked again');
  });

  await h.test('age-check: an unreadable or wrongly shaped record means no outcome holds', () => {
    for (const raw of ['{"outcome":"allowed","checkedAt":', '{"outcome":"adult","checkedAt":"2026-09-24T09:00:00.000Z"}', '{"outcome":"allowed"}', 'null']) {
      const kv = new MapKVBackend();
      kv.set(AGE_CHECK_KEY, raw);
      h.eq(storedAgeGate(kv, CHECKED), 'unchecked', `${raw} -> unchecked`);
    }
  });

  await h.test('age-check: the age steps come only ahead of a due terms step', () => {
    const absent: TermsStatus = { kind: 'absent' };
    const noConsent: ConsentStatus = { kind: 'absent' };
    h.eq(nextLegalStep('unchecked', absent, noConsent, false), 'age-check', 'no outcome: the check runs before the terms');
    h.eq(nextLegalStep('minor-not-approved', absent, noConsent, false), 'age-blocked', 'held: the parental-approval message, never the terms');
    h.eq(nextLegalStep('under-13', absent, noConsent, false), 'age-blocked', 'held under 13: the 13-and-over message, never the terms');
    h.eq(nextLegalStep('allowed', absent, noConsent, false), 'terms', 'allowed: the terms step');
    h.eq(nextLegalStep('allowed', { kind: 'outdated', version: 0 }, noConsent, false), 'terms', 'an outdated acceptance is a due terms step too');
    h.eq(nextLegalStep('unchecked', { kind: 'outdated', version: 0 }, noConsent, false), 'age-check', 'so it is checked first');
    h.eq(nextLegalStep('unchecked', ACCEPTED, noConsent, false), 'consent', 'accepted terms: no age step, straight to consent');
    h.eq(nextLegalStep('unchecked', ACCEPTED, GRANTED, false), null, 'and nothing when both are current');
  });
}
