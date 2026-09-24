/**
 * error-details — the "Send error details" preference (legal-surface-v2 design D10; spec
 * privacy-settings "Settings carries a 'Send error details' switch, on by default").
 *
 * Persisted under `whim.error-details:v1` in the SAME `whim.launcher` KVBackend every other
 * launcher setting uses. Only the literal `'0'` means off: a missing key, any other stored value,
 * or a read that throws all mean on. Nothing is cached, so a diagnostics transport that asks
 * `errorDetailsEnabled(kv)` before each upload decision sees a switch flipped a moment ago.
 *
 * No React Native import — this module must load under the Node acceptance suite, and any
 * diagnostics transport reads the preference through it (`handoff/privacy-settings.md`).
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

const ERROR_DETAILS_KEY = 'whim.error-details:v1';

/** Whether error details may be sent. On unless the user turned the switch off. Never throws. */
export function errorDetailsEnabled(kv: KVBackend): boolean {
  try {
    return kv.getString(ERROR_DETAILS_KEY) !== '0';
    // eslint-disable-next-line no-restricted-syntax -- intentional: an unreadable value means on (spec privacy-settings "a missing or unreadable value means on"), never a thrown error
  } catch {
    return true;
  }
}

/** Persists the switch as `'1'`/`'0'`. */
export function setErrorDetails(kv: KVBackend, on: boolean): void {
  kv.set(ERROR_DETAILS_KEY, on ? '1' : '0');
}
