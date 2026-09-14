# launcher-foundations (chain-1)

Four RN-free modules under `src/host/launcher/`. None imports React Native; all load under the
Node acceptance suite (`npm run launcher:test`).

## `release-config.ts`

```ts
export const WHIM_DOMAIN = 'example.com'; // IANA-reserved placeholder; real domain TBD

export const RELEASE = Object.freeze({
  serverUrl: `https://api.whim.${WHIM_DOMAIN}`,
  webHost: `whim.${WHIM_DOMAIN}`,
  webOrigin: `https://whim.${WHIM_DOMAIN}`,
  privacyPolicyUrl: `${webOrigin}/privacy`,
  supportUrl: `${webOrigin}/support`,
  appLinkBase: `${webOrigin}/a/`,
});

export const AI_CONSENT_VERSION = 1; // positive integer; the only place this value is written
```

`RELEASE` and `AI_CONSENT_VERSION` above are verbatim (module-scope `WEB_ORIGIN` const inlined
for readability). **No other launcher source file — including test files — may contain the
`WHIM_DOMAIN` value (`'example.com'`) or any string derived from it, case-insensitively.**
`test/release-config.suite.ts` enforces this by scanning every `.ts`/`.tsx` file under
`src/host/launcher/` (self- and `release-config.ts`-excluded). Build every URL from `RELEASE`;
never retype the domain.

## `server-address.ts` (additions; existing `loadServerUrl`/`saveServerUrl`/`sanitizeServerUrl` unchanged)

```ts
export function effectiveServerUrl(kv: KVBackend): string;
// saved override (blank/whitespace-only counts as none) else RELEASE.serverUrl. Never throws.

export function clearServerUrl(kv: KVBackend): void;
// deletes the saved override key; next effectiveServerUrl() call returns RELEASE.serverUrl.
```

## `ai-consent.ts`

Key: `whim.ai-consent:v1`, value `{ version: number; grantedAt: string }` (ISO-8601), same
`whim.launcher` KVBackend as `server-address.ts`/`theme.ts`.

```ts
export type ConsentStatus =
  | { kind: 'granted'; grantedAt: string }
  | { kind: 'absent' }
  | { kind: 'outdated' };

export function consentStatus(kv: KVBackend): ConsentStatus;
// missing key, unreadable JSON, or a record missing/mistyped `version`/`grantedAt` -> absent.
// stored version !== AI_CONSENT_VERSION (higher OR lower) -> outdated. Otherwise -> granted.

export function grantConsent(kv: KVBackend, now: string): void;
// now is the ISO-8601 timestamp to record as grantedAt, supplied by the caller (e.g.
// new Date().toISOString()) so callers/tests control it without a real clock. Always writes at
// AI_CONSENT_VERSION.

export function revokeConsent(kv: KVBackend): void;
// deletes the key. A decline is never persisted — callers simply don't call grantConsent.
```

## `app-link.ts`

```ts
export function appLinkFor(id: string): string;
// RELEASE.appLinkBase + encodeURIComponent(id)

export function parseAppLink(url: string): string | null;
```

Accepted grammar: scheme must be exactly `https`; host must equal `RELEASE.webHost`
case-insensitively; path must be `/a/` followed by exactly one non-empty segment with at most one
trailing slash (a second trailing slash reads as an extra empty segment and is rejected); query
and fragment are ignored; the returned id is `decodeURIComponent`d. An unparseable URL, wrong
scheme, wrong host, empty segment, extra segment, or bad percent-encoding all return `null` — the
module never throws. Verified against all three launcher id shapes: `freshAppId()`
(`build-lifecycle.ts`), a seed fixture id (e.g. `"tip-splitter"`), and a fork id shaped
`${repo}__${lineageId}` (`store-access.ts#fork`).

## Invariants for downstream chains

- Every derived-URL literal (server URL, web origin, privacy/support/app-link URLs) must come
  from `RELEASE`, never be retyped — the source-scan suite will fail naming the offending file.
- `consentStatus`/`grantConsent`/`revokeConsent` are the only sanctioned access path to the
  consent grant; nothing else should read or write `whim.ai-consent:v1` directly.
- `appLinkFor`/`parseAppLink` are the only sanctioned app-link grammar; nothing else should build
  or parse `/a/...` paths by hand.
