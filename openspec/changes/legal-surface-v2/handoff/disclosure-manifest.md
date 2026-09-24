# handoff/disclosure-manifest.md — chain-1; read by chains 2, 3, 7, 8

## Module: `contract/src/disclosure-manifest.ts` (no zod, no import)

Server and `scripts/release/` import it by relative path. The device names only `WideningId`, via `import type` from `@whim/contract`.

```ts
export const CATEGORY_IDS = ['request-material', 'phone-id', 'app-integrity', 'usage-records', 'error-details', 'connection-logs', 'reports'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export type ConsentPath = 'main' | 'own-opt-in' | 'user-act';
export type Toggle = 'none' | 'default-on' | 'default-off';           // a Settings switch, and where it starts
export type SavedDataForm = 'none' | 'encrypted-on-phone' | 'readable';
export type KeepRule<C extends string = string> =
  | { readonly kind: 'not-kept' }
  | { readonly kind: 'max-days'; readonly days: number; readonly after: 'collection' | 'last-use' }
  | { readonly kind: 'with'; readonly categories: readonly C[] };      // kept only inside those categories' records
export interface AppleStoreType { readonly type: string; readonly manifestType: string; readonly linked: boolean; readonly purposes: readonly string[] }
export interface PlayStoreType { readonly type: string; readonly optional: boolean; readonly shared: boolean; readonly purposes: readonly string[] }
export interface StoreMapping { readonly apple: readonly AppleStoreType[]; readonly play: readonly PlayStoreType[] } // DisclosureRow = { name, description }
export interface DisclosureCategory<C extends string = string> {
  readonly id: C; readonly rows: readonly DisclosureRow[]; readonly excludes: Readonly<Record<string, string>>;
  readonly keep: KeepRule<C>; readonly consent: ConsentPath; readonly toggle: Toggle; readonly onScreen: boolean;
  readonly savedData: SavedDataForm; readonly store: StoreMapping;
}
export interface RecipientRole { readonly id: string; readonly description: string; readonly namedOnScreen: boolean }
export interface Purpose { readonly id: string; readonly description: string; readonly advertisingOrTracking: boolean }
export interface DataUse<C extends string = string> { readonly category: C; readonly roles: readonly string[]; readonly purposes: readonly string[] } // roles × purposes; [] = recipient named, no purpose (v1 only)
export type CorePromiseId = 'saved-data-unreadable' | 'no-advertising' | 'requests-not-kept'; // CorePromise = { id, text }
export interface DisclosureManifest<C extends string = string> {
  readonly categories: readonly DisclosureCategory<C>[]; readonly roles: readonly RecipientRole[];
  readonly purposes: readonly Purpose[]; readonly uses: readonly DataUse<C>[]; readonly promises: readonly CorePromise[];
}
export const MANIFESTS: Readonly<Record<number, DisclosureManifest<CategoryId>>>;  // { 1, 2 } — APPEND-ONLY
export const BUMP_REASONS: Readonly<Record<number, string>>;                      // {} — keyed by the bumped version
export const RELEASED_SNAPSHOT_DIR = 'contract/disclosure/released';              // v1.json, v2.json checked in
export function latestVersion(manifests?: Readonly<Record<number, unknown>>): number; // → 2; MANIFESTS[latestVersion()] is current, = AI_CONSENT_VERSION
export interface KeepLimit { readonly days: number; readonly after: 'collection' | 'last-use' }
export function keepLimit(manifest: DisclosureManifest, categoryId: string): KeepLimit | undefined; // `with` → longest carrier; undefined = not kept
export function diffManifests(from: DisclosureManifest, to: DisclosureManifest): WideningId[];      // sorted, deduplicated
export function manifestShapeFindings(manifest: DisclosureManifest): string[];
```

## Version 2: categories, screen and roles

| id | rows | on screen | consent / toggle | keep (max) |
|---|---|---|---|---|
| `request-material` | Request; App material | yes (two bullets) | main / none | not kept |
| `phone-id` | Phone ID | yes | main / none | with usage-records, reports |
| `app-integrity` | App-integrity check | no (named via role `platform`) | main / none | 365 d after last use |
| `usage-records` | Usage records | no | main / none | 365 d after last use |
| `error-details` | Error details | yes | main / **default-on** | 90 d |
| `connection-logs` | Connection and log data | no | main / none | 90 d |
| `reports` | Reports | no | **user-act** / none | 365 d |

Roles (`namedOnScreen`): `anycognition` ✓, `service-providers` ✓, `platform` (Apple or Google) ✓, `authorities` ✓,
`successor` ✗ (policy only). Purposes: `build`, `operate`, `safety`, `legal`. Promises: all three `CorePromiseId`s.
Version 1 (only what v1 disclosed): request-material → AnyCognition + AI companies (`service-providers`) for `build`;
phone-id → AnyCognition for `operate`, `safety`; usage-records (90 d) → AnyCognition for `operate`; connection-logs (90 d)
→ AnyCognition, no purpose; reports (90 d, user-act) → AnyCognition for `safety`. No authorities, successor or `legal`.

## Keep-period maximums (chain-2 caps config with these; read them with `keepLimit`, never a literal)

Report retention ≤ `reports` 365 d · ledger retention ≤ `usage-records` 365 d · usage idle (lifetime totals, after last
use) ≤ `usage-records` 365 d · server-controlled log retention ≤ `connection-logs` 90 d · error details ≤ `error-details` 90 d.

## Store mapping

Per category, `store.apple[]` / `store.play[]`. Several categories share a store type: `request-material` + `reports`
→ `OTHER_USER_CONTENT` / `other_user_generated_content`; `phone-id` + `app-integrity` → `DEVICE_ID` /
`device_or_other_ids`. A type's declaration is the union over its categories: required if any `optional: false`, shared
if any `shared: true`, purposes = union. `usage-records` → `PRODUCT_INTERACTION` / `app_interactions`; `error-details`
→ `CRASH_DATA` + `OTHER_DIAGNOSTIC_DATA` / `crash_logs` + `diagnostics`; `connection-logs` → none. Every v2 Apple entry
is `linked: true`; only `request-material` is Play `shared: true`. Apple purpose tokens are `app-privacy.json`'s
(`APP_FUNCTIONALITY`, `ANALYTICS`); Play tokens are `data-safety.json`'s. v1's mapping is what v1 declared (not linked).

## Widening ids (`WideningId`)

`category:<cat>` (new category that leaves the phone without its own opt-in or a user act) · `exclusion:<cat>:<excl>`
(an `excludes` id dropped) · `recipient:<cat>:<role>` · `purpose:<cat>:<purpose>` · `role:<role>` · `keep:<cat>` (newly
kept, longer days, or counted from last use; `with` gaining a carrier) · `default:<cat>` (switch off→on) ·
`consent:<cat>` (own opt-in or user act → main) · `promise:<CorePromiseId>` (removed, or its rule now broken).
A new category's or new role's own pairs are covered by its `category:` / `role:` id.
v1 → v2 = `category:app-integrity`, `category:error-details`, `keep:reports`, `keep:usage-records`,
`purpose:connection-logs:{legal,operate,safety}`, `purpose:phone-id:legal`, `purpose:reports:legal`,
`purpose:request-material:{legal,operate}`, `purpose:usage-records:{legal,safety}`, `recipient:{connection-logs,phone-id,
reports,usage-records}:service-providers`, `role:authorities`, `role:platform`, `role:successor` (20 ids, expanded).

## Release check

```ts
export interface WhatsNewLine { readonly text: string; readonly covers: readonly string[] }
export interface DisclosureReleaseInput {
  readonly manifests?: …;  readonly bumpReasons?: …;   // default MANIFESTS / BUMP_REASONS
  readonly released: Readonly<Record<number, DisclosureManifest>>; readonly consentVersion: number;
  readonly whatsNew: Readonly<Record<string, Readonly<Record<number, WhatsNewLine>>>>; // language → from-version → line
}
export function disclosureReleaseFindings(input: DisclosureReleaseInput): string[]; // [] = may ship
export function checkDisclosureRelease(repoRoot: string): readonly string[]; // scripts/release/lib/disclosure-check.ts, live inputs
```

Refuses: `AI_CONSENT_VERSION` ≠ highest key; version gap; shape findings; a released version widened vs its snapshot; a
version with no snapshot (check `v<N>.json` in with the version: `JSON.stringify(MANIFESTS[N], null, 2)`); N not
widening N−1 without `BUMP_REASONS[N]`; any language's line for any older version whose `covers` ≠ the diff to current.
Wired: gate → `checks/test/release/disclosure.suite.ts` (via `release/index.ts`); release preflight →
`PreflightSnapshot.disclosureFindings`; CLI `node scripts/release/run.mjs disclosure-check` (also in `check`);
`deploy/deploy.sh` → that CLI, right after `preflight_node`, before any build or gcloud call.

## What's-new copy (`src/host/launcher/copy.ts`, beside `COPY`, not in it)

```ts
export interface ConsentWhatsNewLine { readonly text: string; readonly covers: readonly WideningId[] }
export const CONSENT_WHATS_NEW: Readonly<Record<string, Readonly<Record<number, ConsentWhatsNewLine>>>>; // { en: { 1: … } }
```
Chain-3 reads `CONSENT_WHATS_NEW[<language>][grant.version].text`; chain-6 adds `fr` (same `covers`; every language is
checked). Not `COPY` values, so `isOffering` doesn't know them: render as plain text (product-verbs/whim-prose scan them).

## Server (`server/src/consent-practices.ts`)

`PRACTICE_CATEGORIES = CATEGORY_IDS`; `PracticeCategory = CategoryId`; `PRACTICES = practicesFrom(MANIFESTS)` → v1 =
request-envelope's four + `phone-id`, v2 = all seven; `permits`/`consentPractice` unchanged; new categories need no edit.
