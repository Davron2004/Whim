# Context chains: waitlist-hardening

No chain touches a `CONFIG_SET` file (`package.json`, the lockfile, `tsconfig*.json`, eslint, knip, `scripts/gate*.sh`, `scripts/fixloop.sh`, `scripts/worktree.sh`, `.claude/**`, `.codex`, `build/`, `invariants/`, `babel.config.js`, `metro.config.js`). `server/test/acceptance.ts` is not in that set, so the new suite's registration self-gates. No chain is HUMAN-BOOTSTRAP. Every chain self-gates with the unmodified `scripts/gate.sh`. chain-2 and chain-3 also run `npm run -s stores:firestore:test` from the main tree on their committed tip, because worktrees cannot run it (`docs/harness.md`).

Dependency graph:
- chain-1 and chain-2 run in parallel; their files are disjoint.
- chain-2 → chain-3 and chain-2 → chain-4 (contract). chain-3 and chain-4 run in parallel; their files are disjoint.
- chain-1 + chain-4 → chain-5.
- chain-5 → chain-6 (shared site suites).
- chain-7 runs after all of them.
- Tasks 8.x are attended and not dispatched.

## chain-1: consent-category-surface

- tasks: 1.1–1.6
- rationale: one manifest type change and its three readers: the practice table, the release check and the route static check. They share the disclosure vocabulary and the request-edge suite.
- files: `contract/src/disclosure-manifest.ts`, `scripts/release/lib/disclosure-check.ts` (snapshot reader only, if it lives there), `checks/test/release/disclosure.suite.ts`, `server/src/consent-practices.ts`, `server/test/request-edge.suite.ts`
- reads: specs/ai-data-consent/spec.md §"The server's consent practices are derived from the manifest" (MODIFIED), §"Every manifest category declares whether the app or the website collects it"; design.md D6; research.md §B "#110"; handoff: none
- writes-contract: handoff/consent-surface.md (the `surface` type, the waitlist description verbatim, the finding text)

## chain-2: waitlist-store-model

- tasks: 2.1–2.6
- rationale: the `WaitlistStore` contract and its three backends must change together to pass one conformance suite. The purge counts belong to the same stores.
- files: `server/src/waitlist/store.ts`, `server/src/firestore/waitlist-store.ts`, `server/src/admin/purge.ts`, `server/test/store-conformance.suite.ts`, `server/test/firestore-conformance.ts`, `server/test/admin-purge.suite.ts`, `deploy/firestore/indexes.json` (only if the coverage check demands it)
- reads: specs/beta-waitlist/spec.md §"One row per person", §"News emails need express consent, and a withdrawal is sticky", §"Removed addresses stay removed", §"Existing rows move to the opt-in model without loss" (the read-mapping paragraph only), §"Retention and operator access" (purge); specs/server-storage-backends/spec.md (all three MODIFIED requirements); design.md D2, D3, D5; research.md §A.2, §A.4, §A.6; handoff: none
- writes-contract: handoff/waitlist-store.md (interface verbatim, outcomes, legacy-mapping function, collection, table and field names)

## chain-3: waitlist-migration-import

- tasks: 3.1–3.5
- rationale: both admin commands move legacy waitlist data through the shared mapping, against SQLite and the Firestore emulator. They are tested with legacy fixtures from BASE's schema.
- files: `server/src/admin/import-sqlite.ts`, new `server/src/admin/migrate-waitlist.ts`, `server/src/admin/cli.ts`, `server/src/admin/main.ts`, `server/test/import-sqlite.suite.ts`, new `server/test/migrate-waitlist.suite.ts`, `server/test/acceptance.ts`, `server/test/firestore-import.ts` (and `server/test/firestore-conformance.ts` only to register a new export, if the emulator runner needs it)
- reads: specs/beta-waitlist/spec.md §"Existing rows move to the opt-in model without loss"; specs/server-storage-backends/spec.md §"A SQLite data directory can be imported into Firestore" (MODIFIED); design.md D5, §Migration Plan; research.md §A.3; handoff: handoff/waitlist-store.md
- writes-contract: handoff/waitlist-migration.md (the command line, output and totals format, exit codes)
- after: chain-2 (contract read, and both may edit `server/test/firestore-conformance.ts`)

## chain-4: signup-route-operator-cli

- tasks: 4.1–4.5
- rationale: the HTTP edge and the operator CLI are the two callers of the store contract. Each has its own suite, and both carry the #111 rules (log fields, the email rule, formula safety).
- files: `server/src/routes/beta-signup.ts`, `server/src/waitlist/cli.ts`, `server/test/beta-signup.suite.ts`, `server/test/waitlist.suite.ts`
- reads: specs/beta-waitlist/spec.md §"Signup route", §"Emails never logged", §"Signups posted from other sites are refused" (route paragraph), §"Removed addresses stay removed", §"Retention and operator access"; design.md D4, D7; research.md §A.1, §A.3, §A.5; handoff: handoff/waitlist-store.md
- writes-contract: handoff/signup-route.md (outcomes and redirects, the check order, the form fields, CLI commands, output and exit codes, CSV columns)

## chain-5: signup-page-privacy-providers

- tasks: 5.1–5.5
- rationale: the published wording: the form and its notice, the privacy policy sections in both languages, and the provider rows. The legal-pages and site checks hold all of them together.
- files: `deploy/site/beta.html`, `server/src/waitlist/notices.ts`, `deploy/site/privacy.html`, `deploy/site/fr/privacy.html`, `deploy/site/legal-identity.json`, `server/test/beta-site.suite.ts`, `server/test/web-site.suite.ts` (provider-row assertion, if the identity file is read there)
- reads: specs/beta-waitlist/spec.md §"Signup page and result pages", §"Consent wording is recorded", §"Privacy policy covers the waitlist"; design.md D1, D3 (retention wording), D10; research.md §A.7, §B "#114"; handoff: handoff/consent-surface.md, handoff/signup-route.md
- writes-contract: none
- after: chain-1, chain-4 (the route stores `CURRENT_NOTICE_ID`, and chain-4's suites must already be green before the notice id moves)

## chain-6: site-build-referrer-profile-tripwires

- tasks: 6.1–6.4
- rationale: the build and deploy tripwires around the pages: the asset copy, the pages host's headers, and the profile key rule. All of them are exercised by the site and deploy-config suites.
- files: `server/src/site/build.ts`, `server/test/beta-site.suite.ts`, `server/test/web-site.suite.ts`, `deploy/cloudrun/Caddyfile`, `deploy/Caddyfile`, `server/test/deploy-config.suite.ts`
- reads: specs/beta-waitlist/spec.md §"Pages-site fonts and assets", §"Signups posted from other sites are refused" (pages-host paragraph); design.md D4 (referrer), D8, D9; research.md §B "#112", "#113"; handoff: none
- writes-contract: none
- after: chain-5 (both edit `beta-site.suite.ts` and `web-site.suite.ts`)

## chain-7: docs-runbook

- tasks: 7.1–7.2
- rationale: prose only. It is written once, from every contract, so no two chains edit `docs/deploy.md`.
- files: `docs/deploy.md`, `docs/decisions.md`, `docs/capabilities.md`
- reads: design.md (all decisions, §Migration Plan), proposal.md §"CASL position, stated plainly", §"Scope decisions per issue"; handoff: handoff/consent-surface.md, handoff/waitlist-store.md, handoff/waitlist-migration.md, handoff/signup-route.md
- writes-contract: none
- after: chain-1, chain-2, chain-3, chain-4, chain-5, chain-6

## Not dispatched

- tasks 8.1–8.5: the production read, the full deploy, the trap-post smoke, the migration of the 5 rows (dry run, apply, verify), and the issue updates. The orchestrator runs them attended after the run's merge into `main`, with the owner's GCP credentials and an unsandboxed `gh`. 8.4 is the run's only production data write.
