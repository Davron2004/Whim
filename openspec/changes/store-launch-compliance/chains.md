# Context chains: store-launch-compliance

The chains run strictly in sequence. Chains 3 through 6 all edit `LauncherRoot.tsx` and `copy.ts`, and every code chain appends suites to `src/host/launcher/test/acceptance.ts`'s hand-kept import list (research.md A "Tests"), so no two code chains can share a parallel window without colliding on those files. Chain 7 touches only `docs/`, but it quotes the landed `COPY` labels and the platform handoff, so it runs last.

No chain is HUMAN-BOOTSTRAP. None edits `scripts/gate*.sh`, `.claude/**`, `.codex/**`, `invariants/`, `build/*`, `package.json`, `package-lock.json`, `tsconfig*.json`, ESLint config, `knip.json`, `babel.config.js` or `metro.config.js`. No new dependency is added (design D16), and native projects are out of scope. Every new export must have a consumer so knip passes without touching `knip.json`.

External inputs every chain may rely on, since this change applies onto `integration/store-launch` after both:
- `server-connectivity`'s `handoff/server-probe.md` and `handoff/connectivity-state.md` (in its change folder, or its archive folder once archived).
- `@whim/contract`'s `ServiceRefusalCode` (seven members, `budget_exhausted` included), `ReportReason`, `ReportRequest` and `ReportResponse`, as landed by `public-generation-server`. The authority is that change's `specs/generation-contract/spec.md` §§"Report request and response shapes" and "Service refusal codes are a closed vocabulary", plus `specs/server-admission-control/spec.md` §"Every refusal is a structured, user-facing ApiError". Import them type-only in launcher code; Node suites may import the zod values.

## chain-1: launcher-config-foundations

- tasks: 1.1–1.5
- rationale: four new RN-free modules (release config, effective server URL, consent store, link grammar) plus the one-constant source scan. They share one vocabulary (`RELEASE`, KV keys) and no UI.
- reads: specs/release-config/spec.md §"One domain constant derives every Whim URL", §"The compiled-in server is used unless the user sets an override", §"The consent version is declared with the release configuration"; specs/ai-data-consent/spec.md §"Consent grants are versioned"; specs/app-links/spec.md §"App links have one grammar, built and parsed in one module"; design.md D4, D6, D15 (first paragraph); handoff: none
- writes-contract: handoff/launcher-foundations.md (`RELEASE` and `AI_CONSENT_VERSION` verbatim, `effectiveServerUrl`/`clearServerUrl` signatures, the `ConsentStatus` union and consent function signatures, `appLinkFor`/`parseAppLink` signatures and the accepted grammar)

## chain-2: client-refusals-and-report-transport

- tasks: 2.1–2.6
- rationale: everything below the screens that the UI chains consume. That covers the error fields on both transports, the refusal table, the consent-branded options, the report call and payload, and the redaction key. It's one layer (`transport-shared.ts`, `xhr-transport.ts`, `generation-client.ts`, the new pure modules), testable entirely in the Node suite.
- reads: specs/generation-stream-transport/spec.md §"The streaming transport preserves the client error taxonomy"; specs/service-refusals/spec.md §"A refusal is recognised by the contract's closed refusal vocabulary", §"Retry-After holds the retry action until the window passes" (line format only); specs/ai-data-consent/spec.md §"Nothing is sent to the server before consent is granted" (second paragraph); specs/content-reporting/spec.md §"The report sheet collects a reason and an optional note" (bounds), §"The sheet previews exactly the body that Send transmits", §"Sending a report posts it and keeps the user in the app" (wire part), §"Report content never reaches device logs"; specs/host-observability/spec.md §"Sensitive fields are structurally unloggable on the device"; design.md D2, D8, D11, D13 (last paragraph), D14 (payload and client items); handoff: handoff/launcher-foundations.md; external: `@whim/contract` refusal and report types
- writes-contract: handoff/client-refusals-report.md (`GenerationClientError`'s new fields, `ServiceRefusal` type and `serviceRefusalOf`/`retryAtOf`/`retryLine` signatures, `REFUSAL_RULES` shape, `ConsentedClientOptions` and `consentedClientOptions`, the `sendReport` signature and error surface, `ReportDraft`, `buildReportRequest`/`reportPreview`/`reportLogFields`/`reportDraftFor` signatures)
- after: chain-1

## chain-3: consent-gate-and-settings

- tasks: 3.1–3.6
- rationale: the consent screen, the shell-level gate every data-sending entry point routes through, its hookup to `server-connectivity`'s probe loop, and the Settings rework that hosts review, revoke, About and Advanced. It's one user journey through `LauncherRoot.tsx`, `ConsentScreen.tsx` and `SettingsScreen.tsx`.
- reads: specs/ai-data-consent/spec.md (all requirements); specs/app-launcher/spec.md §"The Settings screen persists a server address for the prompt flow", §"The home screen shows a quiet connectivity indicator", §"Settings groups its controls into titled sections, with the server address under Advanced"; specs/server-connectivity/spec.md (all modified and removed requirements); specs/release-config/spec.md §"Privacy policy and support open from Settings and the consent screen"; specs/prompt-flow/spec.md §"The compose entry point shows a server-unreachable notice without blocking generation"; design.md D1, D2, D5, D7; handoff: handoff/launcher-foundations.md, handoff/client-refusals-report.md; external: server-connectivity's handoff/server-probe.md and handoff/connectivity-state.md
- writes-contract: handoff/consent-gate.md (the `consent` `Screen` member and its continuation union, `entryDecision`/`declineTarget` signatures, where `ConsentedClientOptions` is derived in `LauncherRoot`, how a later chain declines an open consent screen, the Settings section order)
- after: chain-2

## chain-4: refusal-ux-in-prompt-flow

- tasks: 4.1–4.6
- rationale: every refusal landing in the five-step flow. That means the notice component, the landing and retry-window logic, the three `LauncherRoot` call sites, pending-record settlement, and the four step screens that render the notice. They share the flow machine's vocabulary and its pending-build lifecycle.
- reads: specs/service-refusals/spec.md (all requirements); specs/pending-builds/spec.md (both modified requirements); specs/prompt-flow/spec.md §"Failure is shown honestly, never as a crash"; design.md D9, D10, D11, D12; handoff: handoff/client-refusals-report.md, handoff/consent-gate.md
- writes-contract: handoff/service-notice.md (`ServiceNotice` props, `retryWindowState` signature, the rule for disabling a primary action during a window)
- after: chain-3

## chain-5: report-sheet

- tasks: 5.1–5.6
- rationale: the report sheet and its three entry points (orb, done step, history header), the sheet primitive it introduces, and the back-policy overlay rule that keeps the sheet from leaking back presses into a running app. It's all host UI around one component.
- reads: specs/content-reporting/spec.md (all requirements); specs/mini-app-back-navigation/spec.md §"System back pops the mini-app's nav stack, then exits at the root"; specs/release-config/spec.md §"Privacy policy and support open from Settings and the consent screen"; design.md D13, D14; handoff: handoff/launcher-foundations.md, handoff/client-refusals-report.md, handoff/service-notice.md
- writes-contract: handoff/sheet-modal.md (`SheetModal` props, its close semantics, and how a host sheet reports `overlayOpen` to the back policy)
- after: chain-4

## chain-6: app-links

- tasks: 6.1–6.5
- rationale: link routing and interruption, the `Linking` wiring, the missing-app screen, the App link reveal sheet, and the platform/ops contract. They all speak the link grammar from chain 1 and the screen-exit vocabulary of the shell.
- reads: specs/app-links/spec.md (all requirements); design.md D15, D16, D17; handoff: handoff/launcher-foundations.md, handoff/consent-gate.md, handoff/sheet-modal.md
- writes-contract: handoff/app-link-platform.md (consumed outside this change by the platform change and ops, and by chain-7; content fixed by design.md D17)
- after: chain-5

## chain-7: docs-store-review-notes

- tasks: 7.1–7.3
- rationale: documentation only. That's the App Review notes, the Play and Apple form drafts with the submission checklist, and the decision-log entry. It's written against the landed labels and the platform handoff so every "tap X" step names a real string.
- reads: design.md D1–D3, D6, D7, D10, D16, D17, D18; specs/ai-data-consent/spec.md §"The disclosure names what is sent, what is never sent, and who receives it"; specs/content-reporting/spec.md §"A report can be started from a running mini-app, the done step, and history"; specs/app-links/spec.md §"Every installed app can reveal its link from the home grid"; `src/host/launcher/copy.ts` (landed labels only); handoff: handoff/app-link-platform.md
- writes-contract: none
- after: chain-6
