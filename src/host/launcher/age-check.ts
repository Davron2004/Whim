/**
 * age-check — the store's age signal, reduced on the phone and kept only as an outcome
 * (legal-surface-v2 design D11; spec store-age-signals). The platform answers through the
 * `WhimAgeSignal` native module (Apple Declared Age Range, Play Age Signals); this module reduces
 * that answer to one of four signals, turns the signal into `allowed` or `blocked`, and stores only
 * `{ outcome, checkedAt }` under `whim.age-check:v1` in the shared `whim.launcher` KVBackend. The
 * raw signal is never stored (Texas Bus. & Com. Code §121.055), and nothing here is ever sent.
 *
 * The legal flow (`consent-flow.ts#nextLegalStep`) asks for a check ahead of the terms step when
 * no outcome still holds: none stored, one older than 30 days, or a blocked one, so a parent's
 * approval through the store takes effect at the next attempt.
 *
 * No React Native import — this module must load under the Node acceptance suite. The native
 * module is read by `installed-age-signal.ts` and passed in.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

/** What the store says about the user, reduced to what Whim acts on. `unavailable` covers an
 *  unsupported OS, a region without a signal, a user the store can't place, and any error. */
type AgeSignal = 'adult' | 'minor-approved' | 'minor-not-approved' | 'unavailable';

/** The only thing an age check keeps. */
export type AgeCheckOutcome = 'allowed' | 'blocked';

/** The age input of the legal flow: a stored or just-derived outcome, or `unchecked` when a check
 *  is due before the terms step. */
export type AgeGate = AgeCheckOutcome | 'unchecked';

const AGE_CHECK_KEY = 'whim.age-check:v1';

/** How long an `allowed` outcome holds before the flow asks the store again. */
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const AGE_SIGNALS: readonly string[] = ['adult', 'minor-approved', 'minor-not-approved', 'unavailable'];

/** The native module's answer as one of the four signals. Anything else (no module, a value this
 *  build doesn't know) is `unavailable`. */
function ageSignalFrom(raw: unknown): AgeSignal {
  return typeof raw === 'string' && AGE_SIGNALS.includes(raw) ? (raw as AgeSignal) : 'unavailable';
}

/** Only a minor without the store's parental approval is held; every other signal continues. */
function ageOutcomeOf(signal: AgeSignal): AgeCheckOutcome {
  return signal === 'minor-not-approved' ? 'blocked' : 'allowed';
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
 * Asks the platform through `read`, reduces its answer, stores `{ outcome, checkedAt }` and returns
 * the outcome. A `read` that throws or rejects counts as `unavailable`, so it continues.
 */
export async function runAgeCheck(kv: KVBackend, read: () => Promise<unknown>, now: () => Date): Promise<AgeCheckOutcome> {
  const signal = await Promise.resolve()
    .then(read)
    .then(ageSignalFrom, (): AgeSignal => 'unavailable');
  const stored: StoredAgeCheck = { outcome: ageOutcomeOf(signal), checkedAt: now().toISOString() };
  kv.set(AGE_CHECK_KEY, JSON.stringify(stored));
  return stored.outcome;
}
