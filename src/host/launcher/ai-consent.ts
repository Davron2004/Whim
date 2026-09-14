/**
 * ai-consent — the AI-data consent grant store (design D4; spec ai-data-consent "Consent grants
 * are versioned"). Persisted under `whim.ai-consent:v1` in the shared `whim.launcher` KVBackend,
 * following the `whim.<name>:v1` convention (`server-address.ts`'s `SERVER_URL_KEY` precedent).
 * Fails closed: a missing, unreadable, or malformed record reads as `absent`, never `granted` —
 * a decline is never persisted either, since the gate simply asks again next time.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { AI_CONSENT_VERSION } from './release-config';

const CONSENT_KEY = 'whim.ai-consent:v1';

export type ConsentStatus =
  | { kind: 'granted'; grantedAt: string }
  | { kind: 'absent' }
  | { kind: 'outdated' };

interface StoredGrant {
  version: number;
  grantedAt: string;
}

function readStoredGrant(kv: KVBackend): StoredGrant | undefined {
  const raw = kv.getString(CONSENT_KEY);
  if (raw == null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // eslint-disable-next-line no-restricted-syntax -- intentional: malformed JSON reads as no grant (spec ai-data-consent "A corrupted record fails closed"), never a thrown error
  } catch {
    return undefined;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { version?: unknown }).version === 'number' &&
    typeof (parsed as { grantedAt?: unknown }).grantedAt === 'string'
  ) {
    return parsed as StoredGrant;
  }
  return undefined;
}

/**
 * The current status of the stored grant against `AI_CONSENT_VERSION` (design D4). A grant whose
 * `version` does not equal the compiled version reads as `outdated`, never `granted`. A missing,
 * unreadable, or malformed record reads as `absent`.
 */
export function consentStatus(kv: KVBackend): ConsentStatus {
  const stored = readStoredGrant(kv);
  if (stored == null) return { kind: 'absent' };
  if (stored.version !== AI_CONSENT_VERSION) return { kind: 'outdated' };
  return { kind: 'granted', grantedAt: stored.grantedAt };
}

/**
 * Persist a fresh grant at the compiled consent version. `now` is the ISO-8601 timestamp to
 * record as `grantedAt`, supplied by the caller so tests control it without a real clock.
 */
export function grantConsent(kv: KVBackend, now: string): void {
  const grant: StoredGrant = { version: AI_CONSENT_VERSION, grantedAt: now };
  kv.set(CONSENT_KEY, JSON.stringify(grant));
}

/** Delete the grant (design D4: revoking deletes the key). */
export function revokeConsent(kv: KVBackend): void {
  kv.delete(CONSENT_KEY);
}
