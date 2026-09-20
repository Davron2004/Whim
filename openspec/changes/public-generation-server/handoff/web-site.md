# web-site (chain-15)

## `node server/site.mjs build --out <dir>`

Bundles `server/src/site/build.ts` like `server/dev.mjs`/`server/admin.mjs` bundle theirs, then
runs it with a real `AssociationFilesRunner` (spawns
`node scripts/release/run.mjs association-files --out <stage>`, cwd = repo root).

Required env: `WHIM_SUPPORT_EMAIL`. Optional: `WHIM_APP_STORE_URL`, `WHIM_PLAY_STORE_URL`.
`WHIM_ENGINEER_MODEL`/`WHIM_REWRITE_MODEL` are required deploy-time values too (D24 — the server
runs with them), but they're not page placeholders and this build doesn't read them. `--out` is
relative to the caller's cwd.

- stdout on success: `association files: present` or
  `association files: absent (<missingPath>); app link verification stays PENDING`.
- stderr on failure: `site build failed: <reason>` (one line, names the cause).
- Exit `0` success · `1` build failure · `2` usage error (missing `build` subcommand or `--out`).

## `server/src/site/build.ts` — pure/testable (no `process.exit`, no stdout)

```ts
export type PlaceholderName =
  | 'WHIM_SUPPORT_EMAIL'
  | 'WHIM_APP_STORE_URL' | 'WHIM_PLAY_STORE_URL';
export type PlaceholderValues = { readonly [K in PlaceholderName]?: string };

export class RenderPageError extends Error {
  constructor(public readonly placeholder: string, message: string);
  // .placeholder is the offending NAME, or '{{' for a leftover marker.
}

export function renderPage(source: string, values: PlaceholderValues): string;

export type AssociationState =
  | { readonly kind: 'present' }
  | { readonly kind: 'absent'; readonly missingPath: string };
export function associationState(repoRoot: string): AssociationState;

export type AssociationFilesRunner = (stageDir: string) => Promise<{ readonly exitCode: number }>;
export interface BuildSiteOptions {
  readonly repoRoot: string; readonly env: NodeJS.ProcessEnv; readonly outDir: string;
  readonly runAssociationFiles: AssociationFilesRunner;
}
export type BuildSiteResult =
  | { readonly ok: true; readonly associationState: 'present' }
  | { readonly ok: true; readonly associationState: 'absent'; readonly missingPath: string }
  | { readonly ok: false; readonly reason: string };
export function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult>;
```

**`renderPage` rules (design D23):** substitutes `{{NAME}}` from the closed `PlaceholderName` set,
HTML-escaping every value. An unknown `{{NAME}}`, a missing/malformed required value
(`WHIM_SUPPORT_EMAIL`), or a leftover `{{` after
substitution throws `RenderPageError` naming the offender. `WHIM_SUPPORT_EMAIL` must look like an
email; `WHIM_APP_STORE_URL`/`WHIM_PLAY_STORE_URL`, if given, must be `https://apps.apple.com/…` /
`https://play.google.com/…`. `<!--IF:NAME-->…<!--ENDIF-->` blocks are kept only when `values[NAME]`
is a non-empty string — used once per store, independently, in `app-link.html`, so the store-links
paragraph as a whole disappears exactly when both store env vars are unset.

**`associationState`:** checks `release/android-upload-cert.sha256` first, then
`release/android-play-signing-cert.sha256`; `absent.missingPath` names whichever is missing first
(upload before Play, matching the real commit order). Today's checkout has neither, so
`buildSite` against the real repo reports `absent` naming the upload path — this is the correct,
expected state, not a bug.

**`buildSite`:** renders all four pages into a temp dir first (any `RenderPageError` fails the
whole build, `{ ok: false, reason: err.message }`). If `associationState` is `present`, stages the
runner's output in a second temp dir, requires exactly `apple-app-site-association` +
`assetlinks.json` (any other file set, or a non-zero `exitCode`, fails the build) and copies both
byte-for-byte into `<tempDir>/.well-known/`. Only on success does it `rmSync`+`renameSync` the temp
dir onto `outDir` — a failure never creates or touches `outDir`. Never prints or exits; that is
`server/site.mjs`'s job.

## Output layout (`<outDir>/`)

`privacy.html`, `support.html`, `app-link.html`, `not-found.html`, and — only when association
state is `present` — `.well-known/apple-app-site-association`, `.well-known/assetlinks.json`.

## Page-to-route map (for chain-12's Caddyfile)

| Path | File |
|---|---|
| `/privacy` | `privacy.html` |
| `/support` | `support.html` |
| `/a/` and everything under it | `app-link.html` |
| `/.well-known/apple-app-site-association` | the file if present, else `404` |
| `/.well-known/assetlinks.json` | the file if present, else `404` |
| anything else | `not-found.html`, `404` |

## Parity allowlist (design D23, verbatim)

Every `src/host/launcher/copy.ts` key starting with `consent` must appear verbatim (tags stripped,
entities decoded, whitespace collapsed, U+2019/`'` treated as equal) in the rendered `privacy.html`
**except**: `consentTitle`, `consentOutdatedLine`, `consentAgree`, `consentDecline`,
`consentReviewKeepOn`, `consentReviewTurnOff`, `consentReviewTurnOn`. This denies by default — a
new `consent…` key fails the suite until `deploy/site/privacy.html` quotes it. The mechanism is the
`missingConsentDisclosures(copy, allowlist, normalizedPolicy)` helper local to
`server/test/web-site.suite.ts`; it is not exported, so extending the allowlist means editing that
one `CONSENT_ALLOWLIST` set and quoting the new text in `privacy.html`, never adding a hand-kept
required-key list (red-checked: a hand-kept list misses an unlisted new key entirely).
`server/test/deploy-config.suite.ts` calls `runWebSiteTests()` first, unconditionally.
