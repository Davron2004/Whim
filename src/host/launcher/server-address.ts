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
const SERVER_CHOICE_KEY = 'whim.server-choice:v1';

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
 * in the draft would double up against `probeServer`'s leading-slash `/health` the same way.
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
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A label a URL parser reads as a number (decimal, or `0x` hex), which turns the host into an IPv4
 *  address: `http://134744072` and `http://0x08080808` are both 8.8.8.8. */
const NUMERIC_LABEL_RE = /^(?:\d+|0x[0-9a-f]*)$/;
const ADDRESS_RE = /^(https?):\/\/([^/?#]+)(?:[/?#].*)?$/i;

/** The host an http authority names, lower-cased, or `undefined` when it carries user info or a
 *  malformed port: either could make the host a fetch reaches differ from the one checked here. */
function hostOf(authority: string): string | undefined {
  const match = /^(\[[^\]]*\]|[^:@[\]]+)(?::\d{1,5})?$/.exec(authority);
  return match?.[1].toLowerCase();
}

/** Whether four IPv4 octets are loopback (127/8), private (10/8, 172.16/12, 192.168/16),
 *  link-local (169.254/16) or carrier-grade NAT (100.64/10, which Tailscale uses). */
function isPrivateIpv4([a, b]: readonly number[]): boolean {
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** A dotted-quad IPv4 literal's four octets, or `undefined`. */
function ipv4Octets(text: string): number[] | undefined {
  return IPV4_RE.test(text) ? text.split('.').map(Number) : undefined;
}

/** An IPv6 literal's eight 16-bit groups (`::` expanded, a trailing dotted IPv4 folded into the
 *  last two), or `undefined` when it isn't one. */
function ipv6Groups(text: string): number[] | undefined {
  let body = text;
  const lastColon = body.lastIndexOf(':');
  if (body.includes('.', lastColon)) {
    const octets = ipv4Octets(body.slice(lastColon + 1));
    if (octets === undefined) return undefined;
    const hex = (high: number, low: number) => (high * 256 + low).toString(16);
    body = `${body.slice(0, lastColon + 1)}${hex(octets[0], octets[1])}:${hex(octets[2], octets[3])}`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return undefined;
  const groupsOf = (part: string) => (part === '' ? [] : part.split(':'));
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (![...head, ...rest].every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const given = head.length + rest.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return undefined;
  const zeros = new Array<string>(8 - given).fill('0');
  return [...head, ...zeros, ...rest].map((group) => Number.parseInt(group, 16));
}

/** Whether a bracketed IPv6 literal is loopback (::1), link-local (fe80::/10), unique-local
 *  (fc00::/7), or an IPv4-mapped address (::ffff:a.b.c.d) whose IPv4 address is private. */
function isPrivateIpv6(bracketed: string): boolean {
  const groups = ipv6Groups(bracketed.slice(1, -1));
  if (groups === undefined) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const octets = (group: number) => [Math.floor(group / 256), group % 256];
    return isPrivateIpv4([...octets(groups[6]), ...octets(groups[7])]);
  }
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const linkLocal = groups[0] >= 0xfe80 && groups[0] <= 0xfebf;
  const uniqueLocal = groups[0] >= 0xfc00 && groups[0] <= 0xfdff;
  return loopback || linkLocal || uniqueLocal;
}

/** A loopback or private-range IP literal (`isPrivateIpv4`, `isPrivateIpv6`), `localhost`, a
 *  `.local` name, or a single-label host that isn't numeric. */
function isLocalHost(host: string): boolean {
  if (host.startsWith('[')) return host.endsWith(']') && isPrivateIpv6(host);
  const octets = ipv4Octets(host);
  if (octets !== undefined) return isPrivateIpv4(octets);
  const labels = host.split('.');
  if (!labels.every((label) => HOST_LABEL_RE.test(label))) return false;
  if (labels.length === 1) return !NUMERIC_LABEL_RE.test(labels[0]);
  return labels.at(-1) === 'local';
}

/**
 * The address rule (design D20; spec native-release-config "Store builds carry no cleartext
 * exception"): an `https://` address is always allowed; an `http://` one only for a host on the
 * user's own network (`isLocalHost`); anything else (another scheme, no scheme) never. A blank
 * value is allowed: it means "no override". Every Android build type permits cleartext at its
 * base, so this rule, not the OS, keeps plain http off the public internet.
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

/** The default port of each scheme an address may use: an origin written with it is the same
 *  origin written without it. */
const DEFAULT_PORT: Readonly<Record<string, string>> = { http: '80', https: '443' };

/** An http(s) address's scheme, host and port as a URL parser reads them: scheme and host
 *  lower-cased, any user info dropped, a default port left out. `undefined` for anything else.
 *  Parsed here rather than with `URL`, which React Native implements only in part. */
function originParts(url: string): { scheme: string; host: string; port: string } | undefined {
  const match = ADDRESS_RE.exec(url.trim());
  if (match == null) return undefined;
  const scheme = match[1].toLowerCase();
  const hostPort = match[2].slice(match[2].lastIndexOf('@') + 1);
  const parts = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hostPort);
  if (parts == null) return undefined;
  const port = parts[2] === undefined || parts[2] === '' || parts[2] === DEFAULT_PORT[scheme] ? '' : parts[2].replace(/^0+(?=\d)/, '');
  return { scheme, host: parts[1].toLowerCase(), port };
}

/** A server address as the user reads it: its host and port, without the scheme, any path, or any
 *  user name and password written into it. An address that isn't an http(s) URL is returned as it
 *  is, less anything up to an `@`. */
export function serverLabel(url: string): string {
  const parts = originParts(url);
  if (parts === undefined) return url.slice(url.lastIndexOf('@') + 1);
  return parts.port === '' ? parts.host : `${parts.host}:${parts.port}`;
}

/** Whether two addresses name the same server: the same origin once parsed (`originParts`), so
 *  case, a default port, user info and a path make no difference. */
export function sameServer(a: string, b: string): boolean {
  const x = originParts(a);
  const y = originParts(b);
  if (x === undefined || y === undefined) return a === b;
  return x.scheme === y.scheme && x.host === y.host && x.port === y.port;
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
 * recorded, while "Whim's server" isn't chosen (`chooseServer`), and only while it passes the
 * address rule, else `undefined`. An address saved by an
 * earlier build stays in place, unread, until the user confirms.
 */
export function serverOverride(kv: KVBackend): string | undefined {
  if (!ownServerAcknowledged(kv) || kv.getString(SERVER_CHOICE_KEY) === 'whim') return undefined;
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

/** The server row chosen in Advanced (spec app-launcher "Settings puts common settings first and
 *  diagnostics under Advanced"). */
export type ServerChoice = 'whim' | 'own';

/**
 * Which row Advanced shows chosen: "Your own server" once the acknowledgement is recorded, unless
 * the user has since picked "Whim's server". Choosing Whim's server keeps the saved address (only
 * `serverOverride` stops reading it), so switching back finds it there with nothing to confirm.
 */
export function serverChoice(kv: KVBackend): ServerChoice {
  return ownServerAcknowledged(kv) && kv.getString(SERVER_CHOICE_KEY) !== 'whim' ? 'own' : 'whim';
}

/** Records the chosen row. `own` honours the saved address only once the acknowledgement exists. */
export function chooseServer(kv: KVBackend, choice: ServerChoice): void {
  if (choice === 'whim') kv.set(SERVER_CHOICE_KEY, 'whim');
  else kv.delete(SERVER_CHOICE_KEY);
}
