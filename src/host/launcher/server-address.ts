/**
 * server-address — the user's own server (beta-1 design D20; spec app-launcher "The Settings
 * screen persists a server address for the prompt flow").
 *
 * The address is persisted under `whim.server-url:v1`, and the once-per-install acknowledgement
 * that has to come before it is honoured under `whim.server-ack:v1`, both in the same
 * `whim.launcher` KVBackend as the theme pref and installed-apps index (`theme.ts`'s `THEME_KEY` /
 * `app-index.ts`'s `SEED_KEY` precedent). Tolerant, never throws: an absent key or a
 * blank/whitespace-only value both resolve to `undefined` ("not configured") rather than an empty
 * string, so callers can gate on a single nullish check (`clientOptions != null` /
 * `serverConfigured`).
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { RELEASE } from './release-config';

const SERVER_URL_KEY = 'whim.server-url:v1';
const SERVER_ACK_KEY = 'whim.server-ack:v1';

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

/** Persist a (possibly blank) address; a blank value clears the key rather than storing "". An
 *  address the rule refuses (`serverAddressAllowed`) is not saved, and the saved one stays.
 *  Returns whether the value was taken. */
export function saveServerUrl(kv: KVBackend, raw: string): boolean {
  const sanitized = sanitizeServerUrl(raw);
  if (sanitized == null) {
    kv.delete(SERVER_URL_KEY);
    return true;
  }
  if (!serverAddressAllowed(sanitized)) return false;
  kv.set(SERVER_URL_KEY, sanitized);
  return true;
}

const IPV4_OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4_RE = new RegExp(String.raw`^${IPV4_OCTET}(?:\.${IPV4_OCTET}){3}$`);
const IPV6_RE = /^\[[0-9a-f.]*:[0-9a-f:.]*\]$/i;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ADDRESS_RE = /^(https?):\/\/([^/?#]+)(?:[/?#].*)?$/i;

/** The host an http authority names, lower-cased, or `undefined` when it carries user info or a
 *  malformed port: either could make the host a fetch reaches differ from the one checked here. */
function hostOf(authority: string): string | undefined {
  const match = /^(\[[^\]]*\]|[^:@[\]]+)(?::\d{1,5})?$/.exec(authority);
  return match?.[1].toLowerCase();
}

/** An IP literal (v4, or bracketed v6), `localhost`, a `.local` name or a single-label host. */
function isLocalHost(host: string): boolean {
  if (IPV4_RE.test(host) || IPV6_RE.test(host)) return true;
  const labels = host.split('.');
  if (!labels.every((label) => HOST_LABEL_RE.test(label))) return false;
  return labels.length === 1 || labels.at(-1) === 'local';
}

/**
 * The address rule (design D20; spec native-release-config "Store builds carry no cleartext
 * exception"): an `https://` address is always allowed, an `http://` one only for a local host
 * (`isLocalHost`), and anything else (another scheme, no scheme) never. A blank value is allowed:
 * it means "no override". The Android release build permits cleartext at its base, so this rule,
 * not the OS, keeps plain http off the public internet.
 */
export function serverAddressAllowed(raw: string): boolean {
  const sanitized = sanitizeServerUrl(raw);
  if (sanitized == null) return true;
  const match = ADDRESS_RE.exec(sanitized);
  if (match == null) return false;
  if (match[1].toLowerCase() === 'https') return true;
  const host = hostOf(match[2]);
  return host != null && isLocalHost(host);
}

/** Whether the user has confirmed, on this install, that their own server isn't Whim's
 *  responsibility. Nothing un-records it: "Use Whim's server" keeps it. */
export function ownServerAcknowledged(kv: KVBackend): boolean {
  return kv.getString(SERVER_ACK_KEY) === '1';
}

/** Records the acknowledgement. The saved address, if any, is honoured from now on. */
export function acknowledgeOwnServer(kv: KVBackend): void {
  kv.set(SERVER_ACK_KEY, '1');
}

/**
 * The override every request follows (design D20): the saved address once the acknowledgement is
 * recorded and only while it passes the address rule, else `undefined`. An address saved by an
 * earlier build stays in place, unread, until the user confirms.
 */
export function serverOverride(kv: KVBackend): string | undefined {
  if (!ownServerAcknowledged(kv)) return undefined;
  const saved = loadServerUrl(kv);
  return saved != null && serverAddressAllowed(saved) ? saved : undefined;
}

/**
 * The server every request actually goes to (release-config "The compiled-in server is used
 * unless the user sets an override"): the honoured override (`serverOverride`), else the
 * compiled-in production server.
 */
export function effectiveServerUrl(kv: KVBackend): string {
  return serverOverride(kv) ?? RELEASE.serverUrl;
}

/**
 * Remove the saved override so the next request goes to the compiled-in server, with no restart
 * needed (same spec, "Going back to the default"). The acknowledgement stays.
 */
export function clearServerUrl(kv: KVBackend): void {
  kv.delete(SERVER_URL_KEY);
}
