/**
 * terms-acceptance — the terms-of-use acceptance store (legal-surface-v2 design D5; spec
 * terms-acceptance "Terms acceptance is versioned apart from consent"). Persisted under
 * `whim.terms:v1` in the shared `whim.launcher` KVBackend as `{ version, acceptedAt }`, beside —
 * never inside — the consent grant (`ai-consent.ts`), so neither version can move the other.
 * Fails closed: a missing, unreadable, or malformed record reads as `absent`, never `accepted`.
 * Declining is never persisted; the flow simply asks again at the next data-sending action.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { TERMS_VERSION } from './release-config';

const TERMS_KEY = 'whim.terms:v1';

/** `accepted` only when the stored version equals `TERMS_VERSION`. `outdated` carries the stored
 *  version: the terms step shows the updated-terms line in place of its lead. */
export type TermsStatus =
  | { kind: 'accepted'; version: number; acceptedAt: string }
  | { kind: 'absent' }
  | { kind: 'outdated'; version: number };

interface StoredAcceptance {
  version: number;
  acceptedAt: string;
}

function isStoredAcceptance(value: unknown): value is StoredAcceptance {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<Record<keyof StoredAcceptance, unknown>>;
  return typeof record.version === 'number' && typeof record.acceptedAt === 'string';
}

/**
 * The stored acceptance against `TERMS_VERSION`: `accepted` on an exact match, `outdated` for any
 * other version, `absent` for a missing, unparseable, or wrongly shaped record.
 */
export function termsStatus(kv: KVBackend): TermsStatus {
  const raw = kv.getString(TERMS_KEY);
  if (raw == null) return { kind: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // eslint-disable-next-line no-restricted-syntax -- intentional: a corrupted record reads as no acceptance (spec terms-acceptance "A corrupted acceptance fails closed"), never a thrown error
  } catch {
    return { kind: 'absent' };
  }
  if (!isStoredAcceptance(parsed)) return { kind: 'absent' };
  if (parsed.version !== TERMS_VERSION) return { kind: 'outdated', version: parsed.version };
  return { kind: 'accepted', version: parsed.version, acceptedAt: parsed.acceptedAt };
}

/** Persist an acceptance of the compiled terms version. `now` is the ISO-8601 `acceptedAt`,
 *  supplied by the caller so tests control it without a real clock. */
export function acceptTerms(kv: KVBackend, now: string): void {
  const acceptance: StoredAcceptance = { version: TERMS_VERSION, acceptedAt: now };
  kv.set(TERMS_KEY, JSON.stringify(acceptance));
}
