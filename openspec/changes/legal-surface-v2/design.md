## Context

The legal research, the owner's seven decisions and the text are all settled. They are in `docs/research/legal-surface-2026-09/README.md` (decisions at its top) and `draft-copy.md`. This design covers only how the text and the README's agent tasks land in code. Code terrain is in `research.md`.

Owner decisions this design builds on (README, 2026-09-23):

1. Three core promises: nobody at Whim can read saved data; no ads, selling or cross-app tracking; requests aren't kept after handling except inside a report.
2. Every storefront stays open. The EU/UK work and the Korean transfer section are therefore pre-launch.
3. AnyCognition Inc., a business address and phone, `privacy@anycognition.ca`, the owner as Privacy Officer by title. Play stays on the personal account for now.
4. French for the terms, the terms step, the consent screen and the policy.
5. Terms under Ontario law, with their own Accept step before the consent screen.
6. Reports and usage records kept at most 12 months; error details, connection data and logs at most 90 days; error details on by default.
7. No lawyer before launch. The brief is written for after.

Dependencies:

- `request-envelope` is applied first. It creates `server/src/consent-practices.ts` and the `x-whim-consent` header (B10). This change fills that table and doesn't touch the header.
- The `ai-data-consent`, `content-reporting` and `app-launcher` deltas modify requirements whose current text lives in the unarchived `store-launch-compliance`. `openspec validate --strict` passes today, but archiving needs the base. Archive order: `store-launch-compliance` (#69), then this change.

## Goals / Non-Goals

**Goals:**

- Every draft-copy text lands: consent v2, terms and the terms step, policy v2, store declarations, listings, review notes, French.
- The re-consent rule becomes machine-checked on both halves. The app build fails if the manifest widened without a version bump. The server derives its practices from the same manifest, and the deploy fails if a keep-period is above its published maximum.
- Every false store answer and every server record the text contradicts (B6, B8) is fixed in the same change as the text.
- The README's agent tasks (B4, B6, B8, B9, note 7, note 18, the breach runbook, the drafts) are done by agents. Console and owner steps are attended tasks.

**Non-Goals:**

- B10: the consent header and its server enforcement. `request-envelope` covers them.
- Zero-retention routing (`zdr: true`). It's hardening that the copy doesn't rely on (README B1). `data_collection: 'deny'` is already sent (f542669).
- The in-app 30-day notice for a material terms change. It gets built with the first such change; none exists yet.
- Moving Play to an organization account (decision 3), a block list by phone ID, and the subscription and sync text (it stays bracketed out).
- Lawyer review (decision 7).

## Decisions

### D1. One manifest module, append-only versions, imported by the server and the release scripts only

`contract/src/disclosure-manifest.ts` is plain TypeScript data with no zod. It exports:

- `MANIFESTS: Record<number, DisclosureManifest>` with keys `1` (the v1 disclosure baseline) and `2` (the README's "Manifest, version 2").
- `diffManifests(from, to): Widening[]`, which implements the rule's widening list. Each `Widening` has a stable id, for example `category:error-details` or `keep:reports`.
- `BUMP_REASONS: Record<number, string>`: reviewed reason entries for a bump that doesn't widen.

A category records: id, display rows, what it excludes, whether Whim keeps it, the published maximum in days, the consent path (`main`, `own-opt-in` or `user-act`), whether it's on by default, and its store mapping (Apple type, linked, purposes; Play type, required or optional, shared). A role records whether the screen must name it. The manifest also lists purposes, allowed (category, role, purpose) triples and the core promises.

The server and `scripts/release/` import it at runtime. The device never does: Metro's resolution stays unchanged, so `guard:metro` holds.

The alternative was a JSON file. It was rejected because the widening diff wants types, and TypeScript data gets typechecked by the gate for free.

### D2. Category ids extend `request-envelope`'s; the server table is derived

`request-envelope` fixed `request-material`, `usage-records`, `connection-logs` and `reports`. Version 2 adds `phone-id`, `error-details` and `app-integrity`. `request-material` covers two display rows, the request and the app material, because the server runs them as one practice.

`server/src/consent-practices.ts` stops hand-listing sets. It computes `PRACTICES[v]` as the set of category ids in `MANIFESTS[v]`, so the server's table and the published text can't drift. Version 1 gains `phone-id`: v1 disclosed the ID, so that isn't a widening. Every category `request-envelope` listed stays in version 1. Its existing `permits` suite keeps passing with the derivation, and a new case covers version 2.

### D3. The release check: frozen snapshots and a consecutive-version diff

The check is a pure function in `contract/`. It runs in three places: the fast gate (through `checks/test/acceptance.ts`, with no `gate.sh` edit), the app release scripts, and `deploy/deploy.sh`. It fails when:

- `AI_CONSENT_VERSION` in `release-config.ts` isn't the highest key in `MANIFESTS`.
- A released version's manifest widened compared with its frozen snapshot (`contract/disclosure/released/v<N>.json`). A released version may only narrow or change wording. Widening needs a new version.
- `diffManifests(MANIFESTS[N-1], MANIFESTS[N])` is empty for some N and `BUMP_REASONS[N]` is missing.
- The what's-new copy for any older version (D4) doesn't cover exactly the widenings from that version to the current one.

This change checks in snapshots for v1 and v2. The alternative, a git-history diff against the last release tag, was rejected: it's fragile in worktrees and shallow clones, and it's invisible in review.

### D4. The what's-new line is authored copy, checked against the diff

The app can't import the manifest at runtime (D1). So each language table in `copy.ts` holds `consentWhatsNew: Record<fromVersion, { text, covers: WideningId[] }>`. The check requires `covers` to equal `diffManifests(MANIFESTS[from], MANIFESTS[current])` for every older version. An author can't ship a bump without writing and declaring a line for every widening, including a longer keep-period. The v1 → v2 text is draft-copy §1's `consentWhatsNew`.

The screen coverage check works the same way. Every manifest category that goes on the screen, and every role it must name, has a copy key that must exist and be non-empty in every language table.

### D5. Terms acceptance is its own record and a second condition of the send gate

`whim.terms:v1` stores `{ version, acceptedAt }`, and `TERMS_VERSION = 1` lives in `release-config.ts`. The one request gate from `ai-data-consent` yields request options only when both a current terms acceptance and a current consent grant exist. Reports stay exempt from both.

A data-sending action without them opens the terms step, then the consent screen, then continues the action. Declining either grants nothing. The terms step shows only when the terms aren't current, and the consent screen only when consent isn't current. Settings → About gains a "Terms of use" link, and `RELEASE.termsUrl` sits next to `privacyPolicyUrl`.

A terms bump never touches the consent version, and a consent bump never re-shows the terms. The terms step carries nothing about data, per Play's prominent-disclosure rule.

### D6. Language: French first for French-language phones, with an English choice kept on the phone

A non-RN `legal-language.ts` resolves `'fr' | 'en'`. It uses a persisted choice (`whim.legal-language:v1`) if there is one. Otherwise it's French when the device's preferred language subtag is `fr`. That's any region: fr-CA is the case the law targets, and this is a superset of it. It reads the locale through `Intl` under Hermes, with the platform's locale constant as fallback, and chain-6 checks both on Android and iOS.

Only the legal keys (terms step, consent screen, what's-new) get a `fr` table. The rest of the app stays English. The terms step and the consent screen each show a one-tap language switch ("Continue in English" / "Continuer en français"), which persists the choice. Links open `/fr/privacy` and `/fr/terms` when French is active, and each page links its twin.

A translation never moves the consent version (D3 treats copy as wording). The alternative, an i18n library, was rejected because only about 40 strings need translating.

### D7. Legal pages from one identity file, with no placeholder allowed out

`deploy/site/legal-identity.json` holds the values only the owner can give:

- legal name, street address, phone
- the privacy mailbox and the Privacy Officer's title
- effective dates
- the optional EU and UK representative contacts
- the provider list rows (name, role, country, contact, what they get, retention)

Pages are filled from it through the site's existing `{{…}}` substitution. The deploy check fails when any published legal page still has an unresolved `{{…}}` or a draft marker (`[B…]`, `[D…]`, or `[` followed by a lowercase placeholder word).

The representative paragraphs render only when their values are set. Appointing the representatives is an attended pre-launch task, not a deploy block. The Korean overseas-transfer section is generated from the provider rows, so the list and the section can't disagree.

### D8. Store declarations are derived from the manifest's store mapping

`PRIVACY_TYPE_MAPPING` in `store-listing.ts` gives way to the manifest's store mapping. `checkNoLinkageOrTracking` becomes `checkNoTracking`, because tracking stays refused. `checkTypeAgreement` requires `app-privacy.json`, `data-safety.json` and `PrivacyInfo.xcprivacy` to declare exactly the mapped types with the mapped linkage, purposes, and required or shared flags.

Error details and the app-integrity check are declared now, before either ships. Both stores present answers as what an app may collect, so nothing changes in a console on diagnostics launch day. Play "Shared" follows the one recorded rule (README note 19): request material is Yes and everything else No.

### D9. Records by phone ID: a last-credited day, an idle purge, one operator tool, capped config

- **The `usage` table** gains `last_credited_day`. It's added by an idempotent migration that backfills today's day for existing rows, and every `credit` updates it.
- **Purging** runs in the existing daily purge path and deletes rows idle for more than `WHIM_USAGE_IDLE_DAYS` (default 365).
- **Config is capped.** Server config parsing refuses at startup any keep-period env value above its category's published maximum in the current manifest. That covers reports, the ledger, idle usage and log retention. The deploy check runs the same parse.
- **`whim-admin device export <id>`** prints one JSON object with every record keyed by that ID: reports, ledger rows and the usage row. **`device delete <id>`** removes them and prints the counts. Both are idempotent. The attestation record from #65 joins both when it ships (README B8).

### D10. Settings: a preference module other changes can read; the override is out of store builds

- **Error details.** A non-RN module exports `errorDetailsEnabled(kv)` and `setErrorDetails(kv, on)`, with key `whim.error-details:v1`, and a missing value means on. `developer-observability` chain-4 reads it through `handoff/privacy-settings.md`.
- **The phone ID.** `device-id.ts` gains `resetDeviceId(kv)`. Settings → About shows the ID as selectable text, with "Make a new ID" behind a confirm step that uses draft-copy's text.
- **The server-address override** is compiled out of store builds by a build flag. Store builds ignore a previously saved override. Internal builds keep it: dev, and the local offline `android:release` used on the emulator. Chain-5 records which flag each build path sets.

### D11. Age signals: a small in-repo native module; only the outcome is kept

`WhimAgeSignal` uses Apple's Declared Age Range on iOS 26+ and Play Age Signals on Android. It returns one of `adult`, `minor-approved`, `minor-not-approved` or `unavailable`. No npm dependency is added: iOS uses a system framework, and Android adds a Gradle dependency.

The launcher checks the signal before the terms step when there's no stored outcome, when the stored outcome is more than 30 days old, or when the last outcome blocked the user. Only `{ outcome: 'allowed' | 'blocked', checkedAt }` is stored. The raw signal is discarded at once (§121.055).

`blocked` keeps the AI features off and explains that a parent can approve through the store. The offline examples still work. `unavailable`, whether from an unsupported OS, a region with no signal or an API error, lets the user through. Nothing about age leaves the phone, so the manifest doesn't change.

### D12. Changes to `developer-observability`, made in this PR

This PR edits that change's spec, design, tasks and chains directly, because they're unapplied planning text:

- diagnostics are declared Linked and read from this manifest (B6)
- a mini-app `errorClass` maps onto a closed built-in set, with `Other` for anything else, and gets a red-check scenario (B9)
- uploads also need the error-details preference (B4)
- chain-4 reads `handoff/privacy-settings.md`

## Risks / Trade-offs

- [Every territory stays open on research that covers Canada, the US, the EU and the UK] → The owner accepted this knowingly (decision 2). The Korean section ships. Brazil, Japan and India stay open questions in the post-launch lawyer brief.
- [No lawyer before launch] → The text ships with the research's own fallbacks. These include the Agree tap as EU ePrivacy consent for the ID, and Play "Shared: Yes" for request material. The brief lists them for after launch.
- [Play stays on a personal account while EU storefronts are open] → The Play DSA trader declaration waits (decision 3), and the listing names a different party from the policy. Filed as a caveat issue.
- [Server and app ordering] → The v2 practices must be deployed before any app build that sends `x-whim-consent: 2`. Otherwise `request-envelope`'s backstop refuses its requests. See the migration plan.
- [Testers holding a v1 grant are asked again] → This is intended and happens once, before public launch.
- [Locale detection under Hermes] → There's a fallback to the platform locale constant. Chain-6 checks both on Android and iOS.
- [The age-signal APIs are new and failures let the user through] → This favours availability over a hard block. Revisit it if the lawyer or a regulator says otherwise.
- [The saved-data promise rests on network-deny acceptance (B7)] → An attended release gate: the v2 copy doesn't ship until `platform-release-readiness` 13.6 and 13.7 pass.

## Migration Plan

1. `request-envelope` is applied and deployed. This change is applied after it.
2. Server deploy: the derived `PRACTICES` with version 2, the `usage` migration and purge, the device tool, and the config caps. It's safe alone: v1 clients keep their v1 practices.
3. The owner's attended pre-release steps: the identity values, the mailbox, the OpenRouter account setting, the Texas §121.053 notice to each store before the changed terms and policy go live, the fluent French and Korean reads, and B7's device runs.
4. Site deploy: `/privacy`, `/terms` and the French pages at v2.
5. App release with `AI_CONSENT_VERSION` 2, `TERMS_VERSION` 1, age signals and the Settings rows. The store forms are submitted in the same release.

Rollback: the app can't lower a released consent version, so an app rollback goes to an older build. The server keeps serving v1 and v2 practices, so the server side needs no rollback. The site pages roll back by redeploying the previous version.

## Open Questions

- Which build flag separates store builds from the local offline `android:release`? Chain-5 records it.
- Does either store want App Attest or Play Integrity declared on its own? This is unverified (README note 22). Check it when #65 ships.
