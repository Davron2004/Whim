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
 * No React Native import — this module must load under the Node acceptance suite. The native
 * module is read by `installed-age-signal.ts` and passed in.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

/** What the store says about the user, reduced to what Whim acts on. `under-13` is a store age
 *  range whose upper bound is below 13; `unavailable` covers an unsupported OS, a region without a
 *  signal, a user the store can't place, and any error. */
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

const AGE_SIGNALS: readonly string[] = ['adult', 'minor-approved', 'minor-not-approved', 'under-13', 'unavailable'];

/** The native module's answer as one of the five signals. Anything else (no module, a value this
 *  build doesn't know) is `unavailable`. */
function ageSignalFrom(raw: unknown): AgeSignal {
  return typeof raw === 'string' && AGE_SIGNALS.includes(raw) ? (raw as AgeSignal) : 'unavailable';
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

/**
 * Asks the platform through `read`, reduces its answer, stores `{ outcome, checkedAt }` (a held
 * result as `blocked`) and returns the result. A `read` that throws or rejects counts as
 * `unavailable`, so it continues.
 */
export async function runAgeCheck(kv: KVBackend, read: () => Promise<unknown>, now: () => Date): Promise<AgeCheckResult> {
  const signal = await Promise.resolve()
    .then(read)
    .then(ageSignalFrom, (): AgeSignal => 'unavailable');
  const result = ageResultOf(signal);
  const stored: StoredAgeCheck = { outcome: result === 'allowed' ? 'allowed' : 'blocked', checkedAt: now().toISOString() };
  kv.set(AGE_CHECK_KEY, JSON.stringify(stored));
  return result;
}
