# Context chains: ios-launcher-back-navigation

The chains run strictly in sequence. All three code chains edit files under `src/host/launcher/`: chains 1 and 3 both edit `test/screen-exits.suite.ts` and `screen-exits.ts`, and chains 2 and 3 both edit `LauncherRoot.tsx`, so no two share a parallel window.

**Cross-change ordering the dispatcher can't infer.** Every chain here touches `src/host/launcher/**`, so none may dispatch until `store-launch-compliance` chain-6 (merged at `a9fd25d`) AND chain-7 have both merged onto `integration/store-launch`. Chain-7 edits only `docs/`, but it quotes the landed launcher labels, and this change would move some of them under it. Check `openspec/changes/store-launch-compliance/progress.md` for chain-7's merge line before dispatching chain-1.

**Overlap with the `launcher-polish-fixes` batch.** Its finding F9 edits one line of `LauncherRoot.tsx` (`onOpenDevProbe`) and adds a case to `test/observability-ui.suite.ts`. Chains 2 and 3 edit other hunks of `LauncherRoot.tsx`; no chain here edits `observability-ui.suite.ts`. No other finding touches a file named below. Merges are serial with a regate, so no `after:` is declared, but the orchestrator must not merge F9 and chain-2 or chain-3 in the same regate window.

No chain is HUMAN-BOOTSTRAP. None edits `scripts/gate*.sh`, `scripts/fixloop.sh`, `.claude/**`, `.codex/**`, `invariants/`, `build/*`, `package.json`, `package-lock.json`, `tsconfig*.json`, ESLint config, `knip.json`, `babel.config.js`, `metro.config.js` or `src/host/launcher/test/run.mjs`. No dependency is added. Every new export has a consumer (the hook and table in `LauncherRoot.tsx` and the screens; `bindSystemBack` in the hook; `planBackAction` in `PlanStep.tsx`), so knip passes without touching `knip.json`. (As built, `consent-flow.ts`'s `consentControls` had no production consumer — `ConsentScreen.tsx` renders from `consent-screen-actions.ts` throughout — and was removed by the `ios-back-fixes` fix chain.)

Chain-4 is ATTENDED: the orchestrator runs it with the owner and a real iPhone, never through an implementer.

## chain-1: launcher-exit-logic

- tasks: 1.1–1.5
- rationale: every piece that can run under Node, written before any screen moves. That's the system-back core and hook, the plan and consent decisions, the exit table with `frameEdgesFor`, and the boundary's `onLeave` pass-through. They share one vocabulary (exits, handlers, kinds) and no screen file.
- files: `src/host/launcher/{system-back.ts,use-system-back.ts,screen-exits.ts}` (new), `prompt-flow.ts`, `consent-flow.ts`, `ScreenBoundary.tsx`, `copy.ts` (one key), `test/screen-exits.suite.ts` (new), `test/prompt-flow-screens.suite.ts`, `test/consent-flow.suite.ts`, `test/acceptance.ts`
- reads: specs/launcher-screen-exits/spec.md §"System back and the visible control perform the same action", §"The consent review screen can always be left without changing consent", §"A screen without a declared exit fails the fast gate" (first paragraph only), §"Controls at the bottom of a screen clear the bottom system area"; specs/host-observability/spec.md §"Every screen renders inside a recoverable error boundary"; design.md D4, D6, D7, D8 (types and rows only), D9, D10; research.md A "Integration points", B "Full `Screen` kind list", B "Consent copy tripwire"; handoff: none
- writes-contract: handoff/exit-logic.md (`BackHandlerLike`, `bindSystemBack` and `useSystemBack` signatures and the once-per-mount rule; `planBackAction` and `consentControls` signatures with the D6 table verbatim; `ScreenKind`, `ExitControl`, `ScreenExit`, `SCREEN_EXITS` rows, `FALLBACK_EXIT`, `frameEdgesFor`; the `onLeave` prop on `ScreenBoundaryProps`/`ScreenFallbackProps`; the `COPY.screenErrorBack` key)
- after: store-launch-compliance chain-6, store-launch-compliance chain-7

## chain-2: launcher-screens-on-the-seam

- tasks: 2.1–2.6
- rationale: every screen component moves from its own listener onto `useSystemBack`, and the four places where back and the visible control disagree or are missing (plan row edit, build's duplicate prop, done's missing listener, consent review-off) are fixed in the same pass. They're all the same small edit shape in sibling screen files, plus the source pins that read those listeners.
- files: `src/host/launcher/{ComposeStep,ClarifyStep,PlanStep,BuildStep,DoneStep,SettingsScreen,HistoryScreen,FailureScreen,ConsentScreen,AppLinkMissingScreen}.tsx`, `flow-chrome.tsx`, `LauncherRoot.tsx` (the `BuildStep` props only), `test/failure-screen.suite.ts`, `test/app-link-ui.suite.ts`, `test/prompt-flow-screens.suite.ts`
- reads: specs/launcher-screen-exits/spec.md §"Every launcher screen except Home can be left with a visible control", §"System back and the visible control perform the same action", §"The consent review screen can always be left without changing consent"; design.md D1, D2, D4, D6, D11; research.md A "Visible controls that already match the listener", "Mismatch 1", "Mismatch 2", B "Source pins that read listeners", B "Details sheet"; handoff: handoff/exit-logic.md
- writes-contract: handoff/screens-on-seam.md (for each migrated screen, the file and the exact identifier passed to `useSystemBack`; the `BuildStep` prop change; any `SCREEN_EXITS` row whose file or label differs from design D8, which chain-3 then corrects in the table)
- after: chain-1

## chain-3: launcher-exit-check-and-frame

- tasks: 3.1–3.5
- rationale: the shell-level wiring that reads the table (the error screen's way home, the root frame's edges), the scanner that turns the table into a gate, the red-checks that prove the gate isn't vacuous against the fully migrated tree, and the decision record. The scanner can only pass once chain-2 has moved every screen, so it lands here.
- files: `src/host/launcher/ScreenErrorFallback.tsx`, `LauncherRoot.tsx` (the `ScreenBoundary` and `SafeAreaView` props), `screen-exits.ts` (row corrections from the chain-2 contract only), `test/screen-exits.suite.ts`, `docs/decisions.md`
- reads: specs/launcher-screen-exits/spec.md §"A screen without a declared exit fails the fast gate", §"Controls at the bottom of a screen clear the bottom system area"; specs/host-observability/spec.md §"Every screen renders inside a recoverable error boundary"; specs/mini-app-back-navigation/spec.md §"A floating affordance offers an always-available exit" (for the decision entry); design.md D3, D5, D7, D8, D10, "Risks / Trade-offs"; research.md A "Constraints and invariants" (safe area), B "Error fallback trap"; handoff: handoff/exit-logic.md, handoff/screens-on-seam.md
- writes-contract: none
- after: chain-2

## chain-4: device-walk (ATTENDED)

- tasks: 4.1–4.3
- rationale: the only proof that matters for App Review is a person on an iPhone leaving every screen and sheet by tapping. It also checks the bottom inset on both platforms, which no Node suite can see. It can share the iPhone session with `platform-release-readiness` chain-12.
- reads: specs/launcher-screen-exits/spec.md (all scenarios); specs/mini-app-back-navigation/spec.md §"A floating affordance offers an always-available exit"; design.md D4, D6, D10; tasks.md 4.1–4.3 (the walk itself); handoff: handoff/screens-on-seam.md
- writes-contract: none (results go to `progress.md`)
- after: chain-3; for the ⚙ and tile-label rows, `launcher-polish-fixes` F1 and F4 merged (otherwise mark those two rows N/A)
