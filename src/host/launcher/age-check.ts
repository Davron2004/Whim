/**
 * age-check — the store's age signal, reduced on the phone and kept only as an outcome
 * (legal-surface-v2 design D11; spec store-age-signals). The platform answers through the
 * `WhimAgeSignal` native module (Apple Declared Age Range, Play Age Signals); this module reduces
 * that answer to one of five signals, turns the signal into `allowed` or `blocked`, and stores only
 * `{ outcome, checkedAt }` under `whim.age-check:v1` in the shared `whim.launcher` KVBackend. The
 * raw signal is never stored (Texas Bus. & Com. Code §121.055), and nothing here is ever sent.
 * Which of the two held messages shows (a parent can approve, or 13 and over) comes from the
 * check's own answer within the session; a stored `blocked` is asked again anyway.
 *
 * The legal flow (`consent-flow.ts#nextLegalStep`) asks for a check ahead of the terms step when
 * no outcome still holds: none stored, one older than 30 days, or a blocked one, so a parent's
 * approval through the store takes effect at the next attempt.
 *
 * The store gets 3 seconds to answer (beta-1 D1, #100): a native call still unsettled by then
 * counts as `unavailable`, through the same reduction as any other answer.
 *
 * A guardian acknowledges a significant terms change (beta-1 D2; spec store-age-signals "A
 * supervised minor's guardian acknowledges a significant terms change"): when this check's signal
 * is `minor-approved`, the stored terms acceptance is for an older terms version, and the platform
 * has the acknowledgment (iOS), the check asks the store whether it is required (3 seconds) and,
 * if so, the guardian (60 seconds: it waits on a person). `declined` holds the user as
 * `minor-not-approved` does. `acknowledged` is kept as `{ outcome, termsVersion }` under
 * `whim.significant-update:v1`, so it isn't asked again for that terms version. Anything else
 * continues for this check only and keeps nothing.
 *
 * No React Native import — this module must load under the Node acceptance suite. The native
 * module is read by `installed-age-signal.ts` and passed in.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import type { TimerLike } from './connectivity';
import { TERMS_VERSION } from './release-config';
import { termsStatus } from './terms-acceptance';

/** What the store says about the user, reduced to what Whim acts on. `under-13` is a store age
 *  range whose upper bound is below 13; `unavailable` covers an unsupported OS, a region without a
 *  signal, a user the store can't place, any error, and no answer in time. */
type AgeSignal = 'adult' | 'minor-approved' | 'minor-not-approved' | 'under-13' | 'unavailable';

/** The only thing an age check keeps. */
type AgeCheckOutcome = 'allowed' | 'blocked';

/** Why a check held the user, which picks the held message: a minor without the store's parental
 *  approval, or a user under 13. Never stored. */
export type AgeHold = 'minor-not-approved' | 'under-13';

/** What a check returns: `allowed`, or the reason it held the user (stored as `blocked`). */
export type AgeCheckResult = 'allowed' | AgeHold;

/** The age input of the legal flow: a stored or just-derived result, or `unchecked` when a check
 *  is due before the terms step. */
export type AgeGate = AgeCheckResult | 'unchecked';

const AGE_CHECK_KEY = 'whim.age-check:v1';

/** How long an `allowed` outcome holds before the flow asks the store again. */
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** How long the store may take to answer before the check stops waiting for it. */
const STORE_ANSWER_DEADLINE_MS = 3000;

/** How long the guardian may take over the significant-change acknowledgment. */
const GUARDIAN_DEADLINE_MS = 60_000;

const ACKNOWLEDGMENT_KEY = 'whim.significant-update:v1';

/** The one acknowledgment record that counts: this terms version's. Anything else asks again. */
const ACKNOWLEDGED_RECORD = JSON.stringify({ outcome: 'acknowledged', termsVersion: TERMS_VERSION });

const REAL_TIMERS: TimerLike = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

/** The platform's significant-change acknowledgment (Apple Declared Age Range, iOS 26.4+). */
export interface SignificantUpdateSheet {
  /** Whether the store requires a guardian to be told of a significant change. Only `true`
   *  means it does. */
  required: () => Promise<unknown>;
  /** Shows the guardian the acknowledgment with `description`: `acknowledged`, `declined` or
   *  `unavailable`. Anything else counts as `unavailable`. */
  acknowledge: (description: string) => Promise<unknown>;
}

export interface AgeCheckOptions {
  /** The timers the deadlines run on (default: the real ones). */
  timers?: TimerLike;
  /** The platform's acknowledgment and the line it shows the guardian. Absent where the platform
   *  has none (Android), which continues as `unavailable` does. */
  significantUpdate?: { sheet: SignificantUpdateSheet; description: string };
}

/** What `ask` answers, or `undefined` when it throws, rejects or hasn't settled within `ms`: what
 *  a build without the native module answers, so the reductions treat all three the same. The
 *  timer is cleared once `ask` settles; a late answer is dropped. */
function answerWithin(ask: () => Promise<unknown>, ms: number, timers: TimerLike): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const timer = timers.setTimeout(() => resolve(undefined), ms);
    const settle = (answer: unknown) => {
      timers.clearTimeout(timer);
      resolve(answer);
    };
    Promise.resolve()
      .then(ask)
      .then(settle, () => settle(undefined));
  });
}

const AGE_SIGNALS: ReadonlySet<string> = new Set(['adult', 'minor-approved', 'minor-not-approved', 'under-13', 'unavailable']);

/** The native module's answer as one of the five signals. Anything else (no module, a value this
 *  build doesn't know) is `unavailable`. */
function ageSignalFrom(raw: unknown): AgeSignal {
  return typeof raw === 'string' && AGE_SIGNALS.has(raw) ? (raw as AgeSignal) : 'unavailable';
}

/** A minor without the store's parental approval and a user under 13 are held; every other signal
 *  continues. */
function ageResultOf(signal: AgeSignal): AgeCheckResult {
  return signal === 'minor-not-approved' || signal === 'under-13' ? signal : 'allowed';
}

interface StoredAgeCheck {
  outcome: AgeCheckOutcome;
  checkedAt: string;
}

function readStored(kv: KVBackend): StoredAgeCheck | undefined {
  const raw = kv.getString(AGE_CHECK_KEY);
  if (raw == null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // eslint-disable-next-line no-restricted-syntax -- intentional: an unreadable record means no outcome holds, so the flow checks again
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Partial<Record<keyof StoredAgeCheck, unknown>>;
  if ((record.outcome !== 'allowed' && record.outcome !== 'blocked') || typeof record.checkedAt !== 'string') return undefined;
  return { outcome: record.outcome, checkedAt: record.checkedAt };
}

/**
 * The age input the legal flow starts from: `allowed` while a stored `allowed` outcome is less than
 * 30 days old, else `unchecked`. A blocked outcome, a missing or unreadable one, and one dated after
 * `now` all read as `unchecked`.
 */
export function storedAgeGate(kv: KVBackend, now: Date): AgeGate {
  const stored = readStored(kv);
  if (stored?.outcome !== 'allowed') return 'unchecked';
  const age = now.getTime() - Date.parse(stored.checkedAt);
  return age >= 0 && age <= RECHECK_AFTER_MS ? 'allowed' : 'unchecked';
}

/** Whether a guardian has to acknowledge the terms change first: the stored acceptance is for an
 *  older terms version, and no acknowledgment of the current one is kept. */
function acknowledgmentDue(kv: KVBackend): boolean {
  const terms = termsStatus(kv);
  return terms.kind === 'outdated' && terms.version < TERMS_VERSION && kv.getString(ACKNOWLEDGMENT_KEY) !== ACKNOWLEDGED_RECORD;
}

/** The guardian's answer: `unavailable` unless the store says, within 3 seconds, that the
 *  acknowledgment is required and the guardian then acknowledges or declines within 60. */
async function guardianAnswer(sheet: SignificantUpdateSheet, description: string, timers: TimerLike): Promise<'acknowledged' | 'declined' | 'unavailable'> {
  if ((await answerWithin(sheet.required, STORE_ANSWER_DEADLINE_MS, timers)) !== true) return 'unavailable';
  const answer = await answerWithin(() => sheet.acknowledge(description), GUARDIAN_DEADLINE_MS, timers);
  return answer === 'acknowledged' || answer === 'declined' ? answer : 'unavailable';
}

/** The result of an approved minor's check: held as `minor-not-approved` when the guardian
 *  declines the terms change, allowed otherwise. Keeps an acknowledgment for this terms version. */
async function approvedMinorResult(kv: KVBackend, options: AgeCheckOptions, timers: TimerLike): Promise<AgeCheckResult> {
  if (options.significantUpdate === undefined || !acknowledgmentDue(kv)) return 'allowed';
  const answer = await guardianAnswer(options.significantUpdate.sheet, options.significantUpdate.description, timers);
  if (answer === 'acknowledged') kv.set(ACKNOWLEDGMENT_KEY, ACKNOWLEDGED_RECORD);
  return answer === 'declined' ? 'minor-not-approved' : 'allowed';
}

/**
 * Asks the platform through `read`, reduces its answer, stores `{ outcome, checkedAt }` (a held
 * result as `blocked`) and returns the result. A `read` that throws, rejects or hasn't settled
 * within 3 seconds counts as `unavailable`, so it continues. An approved minor whose accepted terms
 * are older than the current ones is asked for the guardian's acknowledgment first.
 */
export async function runAgeCheck(kv: KVBackend, read: () => Promise<unknown>, now: () => Date, options: AgeCheckOptions = {}): Promise<AgeCheckResult> {
  const timers = options.timers ?? REAL_TIMERS;
  const signal = ageSignalFrom(await answerWithin(read, STORE_ANSWER_DEADLINE_MS, timers));
  const result = signal === 'minor-approved' ? await approvedMinorResult(kv, options, timers) : ageResultOf(signal);
  const stored: StoredAgeCheck = { outcome: result === 'allowed' ? 'allowed' : 'blocked', checkedAt: now().toISOString() };
  kv.set(AGE_CHECK_KEY, JSON.stringify(stored));
  return result;
}
