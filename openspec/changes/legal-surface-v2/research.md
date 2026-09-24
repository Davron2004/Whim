# Research digest: what does landing #63's v2 legal surface touch?

The legal research is done and is not repeated here. **`docs/research/legal-surface-2026-09/README.md` is this change's research**: the seven owner decisions (answered 2026-09-23, recorded at its top), blockers B1–B10, the requirements table, the re-consent rule, the version-2 manifest, and "What else changes". **`draft-copy.md`** in the same folder is the text to land. Section references like "README B8" or "draft-copy §4" point there.

Below is the code and spec terrain only, from a researcher pass over this worktree on 2026-09-23.

## Relevant files

- `openspec/changes/store-launch-compliance/specs/ai-data-consent/spec.md` — the only copy of the `ai-data-consent` capability (not in `openspec/specs/`; that change is unarchived, #69). L35 names OpenRouter on the screen; L66 versions grants under `whim.ai-consent:v1`.
- `openspec/changes/request-envelope/` — adds `x-whim-consent` on every `/v1` request and a server consent-practices table (design D7: `server/src/consent-practices.ts`, categories `request-material`, `usage-records`, `connection-logs`, `reports`, "plus later `error-details` and anything v2 adds"; `PRACTICES: Record<version, ReadonlySet<category>>`, append-only, version `1`; `permits(version, category)`). Spec L65: "The server runs a practice only when the request's consent version covers it". It does not bump `AI_CONSENT_VERSION`.
- `openspec/changes/developer-observability/` — `device-diagnostics` spec (L143 said "not linked to identity"), design D2 (`errorClass` bounded, not closed), D11 (disclosure comes from #63). Chains 4 and 5 wait for #63.
- `src/host/launcher/copy.ts` — `COPY`; consent keys ~L254–278 (`consentLead` names OpenRouter), report keys ~L176–207 (`reportAnonIdLine`, `reportThanksTitle`).
- `src/host/launcher/release-config.ts` — `AI_CONSENT_VERSION = 1` (L39); `RELEASE.privacyPolicyUrl`/`supportUrl` from `WHIM_DOMAIN`; no `termsUrl`.
- `src/host/launcher/ConsentScreen.tsx`, `consent-flow.ts`, `consent-screen-actions.ts`, `ai-consent.ts`, `consent-options.ts` — screen and gate. Tests: `test/consent-gate-ui.suite.tsx`, `test/ai-consent.suite.ts`.
- `src/host/launcher/SettingsScreen.tsx` — sections AI features, Highlighting, About, Advanced (server-address override).
- `src/host/launcher/device-id.ts` — `getDeviceId(kv)`, key `whim.device:v1`, `crypto.randomUUID()`; no reset.
- `deploy/site/` — `privacy.html`, `support.html`, `app-link.html`, `not-found.html`; no `terms.html`.
- `release/store/` — `answers.md`; `app-store/{app-privacy.json, age-rating.json, en-US/description.txt, review_information/notes.txt, …}`; `play/{data-safety.json, en-US/full_description.txt, …}`.
- `ios/Whim/PrivacyInfo.xcprivacy` — two collected types (OtherUserContent, DeviceID), both `Linked: false`.
- `scripts/release/lib/store-listing.ts` — `PRIVACY_TYPE_MAPPING` (two entries), `checkTypeAgreement`, `checkNoLinkageOrTracking` (refuses `DATA_LINKED_TO_YOU`). Suite: `checks/test/release/store-listing.suite.ts` via `npm run checks:test`.
- `docs/store/review-notes.md` — reviewer notes draft; network-deny TODO gated on `platform-release-readiness` 13.6/13.7.
- `server/src/usage-store.ts` — tables `usage` (device_id PK, token totals, no timestamp, never purged) and `requests` (ledger, `purgeLedger(beforeUtcDay)`).
- `server/src/admin/cli.ts` — `reports list|show|purge`, `usage`; no device subcommand.
- `server/src/openrouter.ts` — `requestBody` already sends `provider: { data_collection: 'deny' }` (commit f542669, B1's code half). No `zdr`.

## Current behavior

The v1 consent screen names OpenRouter, calls the phone ID "anonymous" and says saved data is never sent. The grant is `{version, grantedAt}` compared with `AI_CONSENT_VERSION` 1; an outdated grant shows one generic "has changed" line. Store declarations list two types, both "not linked", and the release check enforces "not linked". The lifetime `usage` table keeps one row per device ID forever. No i18n or locale detection exists anywhere in `src/`. No age-signal code exists (only the static `age-rating.json`, `THIRTEEN_PLUS`). The server-address override shows in every build under Settings → Advanced (a release-build gate was not found; unverified in `settings-sections.ts` and native config).

## Constraints and invariants

- Grants fail closed on a missing or malformed record; nothing is sent before a current grant, except a hand-sent report (`ai-data-consent` L3).
- `request-envelope`'s `PRACTICES` is append-only and its category ids are fixed by that change.
- zod never enters Metro; the device imports `@whim/contract` types only. `guard:metro` asserts the workspaces don't change what Metro resolves.
- Node suites can't import RN components; pure logic goes in non-RN siblings.
- No Node suite asserts literal copy strings (they import `COPY`), so copy rewrites don't break `launcher:test`. `ai-consent.suite.ts` fixtures may hardcode version `1` (not verified).

## Integration points

- `COPY` keys and `ConsentScreen.tsx` for v2 text; the consent flow for a terms step in front of it.
- `release-config.ts` for `AI_CONSENT_VERSION` 2 and a terms URL.
- `server/src/consent-practices.ts` (created by `request-envelope`) for version-2 practices.
- `store-listing.ts` and `checks/test/release/` for the declaration check.
- `usage-store.ts` purge path and `admin/cli.ts` for B8.

## Risks and unknowns

- `ai-data-consent` has no base spec in `openspec/specs/` until `store-launch-compliance` is archived.
- I did not verify the live `app-launcher` spec's text about Settings sections or the server-address override.
- I did not verify which suites `server/test/run.mjs` includes for `usage-store.ts` and `admin/cli.ts`.
