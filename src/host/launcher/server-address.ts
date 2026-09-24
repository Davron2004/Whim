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
import { RELEASE } from './release-config';

const SERVER_URL_KEY = 'whim.server-url:v1';

/**
 * Trims, strips trailing slashes (one or more — `host:8787///` → `host:8787`), and drops a blank
 * result to `undefined`. Never throws.
 *
 * Trailing-slash stripping matters because `generation-client.ts` concatenates this address with
 * a leading-slash path (e.g. `/v1/clarify`); a stored trailing slash would double it to `//v1/...`,
 * which the server 404s (no non-exact-path matching). Exported so `server-probe.ts`'s callers can
 * apply the same normalization to a draft address before probing it (`handoff/server-probe.md`:
 * "`baseUrl` is passed through unvalidated ... already sanitized by `server-address.ts`'s
 * `loadServerUrl`/`saveServerUrl` before it reaches this module") — without it, a trailing slash
 * in the draft would double up against `probeServer`'s leading-slash `/healthz` the same way.
 */
export function sanitizeServerUrl(raw: string | null | undefined): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === '/') {
    end -= 1;
  }
  const deslashed = trimmed.slice(0, end);
  return deslashed.length > 0 ? deslashed : undefined;
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

/**
 * The override this build honours (legal-surface-v2 design D10; spec app-launcher "Store builds
 * SHALL … ignore any override saved by an earlier build"): the saved address in an internal build,
 * always `undefined` in a store build. A store build leaves the saved value in place, unread.
 * `internalBuild` comes from `installed-app-info.ts#installedInternalBuild`.
 */
export function serverOverride(kv: KVBackend, { internalBuild }: { internalBuild: boolean }): string | undefined {
  return internalBuild ? loadServerUrl(kv) : undefined;
}

/**
 * The server every request actually goes to (release-config "The compiled-in server is used
 * unless the user sets an override"): the override this build honours (`serverOverride` — a blank
 * or whitespace-only saved value already reads as "no override") — else the compiled-in
 * production server.
 */
export function effectiveServerUrl(kv: KVBackend, internalBuild: boolean): string {
  return serverOverride(kv, { internalBuild }) ?? RELEASE.serverUrl;
}

/**
 * Remove the saved override so the next request goes to the compiled-in server, with no restart
 * needed (same spec, "Clearing the override restores the default").
 */
export function clearServerUrl(kv: KVBackend): void {
  kv.delete(SERVER_URL_KEY);
}
