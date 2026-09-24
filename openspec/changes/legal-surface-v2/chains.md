# Context chains: legal-surface-v2

Preconditions outside this change: `request-envelope` is applied (it creates `server/src/consent-practices.ts` and the envelope header), and `store-launch-compliance` is archived before this change is archived (#69). None of these chains edits a protected or `CONFIG_SET` file. That list covers `package.json`, `gate.sh`, `.claude/**`, `invariants/` and `build/*`. So no chain is HUMAN-BOOTSTRAP. Chain-11 is the owner's attended work and is never dispatched.

Every text chain reads `docs/research/legal-surface-2026-09/draft-copy.md` (the section named in its tasks) and the owner decisions at the top of `README.md`.

## chain-1: contract-disclosure-manifest

- tasks: 1.1–1.6
- rationale: the manifest, its diff, the release check and the server's derived practices form one vocabulary. Every later chain reads it.
- reads: specs/ai-data-consent/spec.md §"The consent version changes only when the disclosure manifest widens", §"The server's consent practices are derived from the manifest"; design.md D1–D4; README "Manifest, version 2", "Store mapping", "Re-consent rule"; handoff: `openspec/changes/request-envelope/handoff/envelope.md`
- writes-contract: handoff/disclosure-manifest.md (manifest types and exports, category ids, `diffManifests`, the check's entry points, where the check is wired)

## chain-2: server-device-records

- tasks: 2.1–2.4
- rationale: all inside the server's usage store, config parsing and admin CLI.
- reads: specs/device-records/spec.md §all three requirements; design.md D9; handoff: handoff/disclosure-manifest.md
- writes-contract: none
- after: chain-1 (both edit `deploy/deploy.sh`)

## chain-3: launcher-consent-v2

- tasks: 3.1–3.5
- rationale: the consent screen, its copy and the report sheet share `copy.ts` and the consent suites.
- reads: specs/ai-data-consent/spec.md §"The disclosure names what is sent…", §"Consent grants are versioned"; specs/content-reporting/spec.md §"The sheet previews exactly the body that Send transmits"; design.md D4; draft-copy §1; handoff: handoff/disclosure-manifest.md
- writes-contract: handoff/legal-copy.md (copy-table shape for legal keys, the `consentWhatsNew` shape, the active-language hook seam, the coverage check's entry point)

## chain-4: launcher-terms-step

- tasks: 4.1–4.4
- rationale: the terms record, the terms screen, the two-step flow and the send gate all sit in the consent flow modules.
- reads: specs/terms-acceptance/spec.md §all four requirements; design.md D5; draft-copy §1 "Terms step"; handoff: handoff/legal-copy.md
- writes-contract: handoff/terms-flow.md (flow order, the hook where a pre-terms check runs, the gate's signature)

## chain-5: launcher-settings

- tasks: 5.1–5.3
- rationale: every task edits `SettingsScreen.tsx` and its sections; the preference module is the seam for `developer-observability` chain-4.
- reads: specs/privacy-settings/spec.md §both requirements; specs/app-launcher/spec.md §both requirements; design.md D10; draft-copy §1 "Settings, report sheet"; handoff: handoff/legal-copy.md
- writes-contract: handoff/privacy-settings.md (`errorDetailsEnabled`, `setErrorDetails`, `resetDeviceId` signatures and keys)
- after: chain-4 (both edit `copy.ts` and the Settings About section)

## chain-6: launcher-french

- tasks: 6.1–6.4
- rationale: the language resolution, the French table and its gate check touch every legal screen after chains 3–5 have settled them.
- reads: specs/legal-text-localization/spec.md §both requirements; design.md D6; handoff: handoff/legal-copy.md, handoff/terms-flow.md
- writes-contract: none
- after: chain-5

## chain-7: site-legal-pages

- tasks: 7.1–7.5
- rationale: all under `deploy/site/` plus the site deploy check.
- reads: specs/legal-pages/spec.md §all four requirements; design.md D7; draft-copy §2 and §6; handoff: handoff/disclosure-manifest.md
- writes-contract: none
- after: chain-2 (`deploy/deploy.sh`), chain-3 (both register checks in `checks/test/acceptance.ts`)

## chain-8: release-store-declarations

- tasks: 8.1–8.4
- rationale: the release checker, the three declaration files, the listings and the review notes are one release-tooling surface.
- reads: specs/store-privacy-declarations/spec.md §both requirements; design.md D8; draft-copy §3, §4, §5; handoff: handoff/disclosure-manifest.md
- writes-contract: none
- after: chain-1 (both edit `scripts/release/`)

## chain-9: launcher-age-signals

- tasks: 9.1–9.6
- rationale: the native modules on both platforms, the JS reduction and the one flow hook form one feature.
- reads: specs/store-age-signals/spec.md §both requirements; design.md D11; README note 18; handoff: handoff/terms-flow.md, handoff/legal-copy.md
- writes-contract: none
- after: chain-6 (the flow and the French table), chain-8 (both edit the review-notes files)

## chain-10: docs-compliance

- tasks: 10.1–10.5
- rationale: new documents under `docs/legal/` only; no code.
- reads: README "Check with a lawyer", "Blockers", notes 3 and 18; `canada.md`, `eu-uk-us.md`; design.md Risks; handoff: none
- writes-contract: none

## chain-11: attended-owner-steps (ATTENDED, not dispatchable)

- tasks: 11.1–11.12
- rationale: console, account, signature, hiring and real-device work only the owner can do. The build orchestrator stops and asks before each one.
- reads: design.md Migration Plan; `docs/legal/*` from chain-10
- writes-contract: none
- after: 11.1 before the site deploy; 11.4 after chain-10; 11.7 after chains 6 and 7; 11.8 and 11.10 before any v2 copy is released; 11.11 last
