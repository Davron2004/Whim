/**
 * server-address — the manually entered generation-server address (design D3; spec "The
 * Settings screen persists a server address for the prompt flow").
 *
 * Persisted under `whim.server-url:v1` in the same `whim.launcher` KVBackend as the theme pref
 * and installed-apps index (`theme.ts`'s `THEME_KEY` / `app-index.ts`'s `SEED_KEY` precedent).
 * Tolerant, never throws: an absent key or a blank/whitespace-only value both resolve to
 * `undefined` ("not configured") rather than an empty string, so callers can gate on a single
 * nullish check (`clientOptions != null` / `serverConfigured`).
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

const SERVER_URL_KEY = 'whim.server-url:v1';

/** Trims and drops a blank result to `undefined`. Never throws. */
function sanitizeServerUrl(raw: string | null | undefined): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read the persisted server address, or `undefined` when unset/blank ("not configured"). */
export function loadServerUrl(kv: KVBackend): string | undefined {
  return sanitizeServerUrl(kv.getString(SERVER_URL_KEY));
}

/** Persist a (possibly blank) address; a blank value clears the key rather than storing "". */
export function saveServerUrl(kv: KVBackend, raw: string): void {
  const sanitized = sanitizeServerUrl(raw);
  if (sanitized == null) {
    kv.delete(SERVER_URL_KEY);
  } else {
    kv.set(SERVER_URL_KEY, sanitized);
  }
}
