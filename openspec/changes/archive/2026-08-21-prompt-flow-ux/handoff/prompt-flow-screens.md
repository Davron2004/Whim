# Handoff: prompt-flow-screens (chain-3)

Four new presentational launcher screens (`src/host/launcher/{Prompt,RewritePreview,Generating,
Failure}Screen.tsx`) + their `COPY` additions. All async orchestration (rewrite call, SSE loop,
abort wiring, delivery routing) lives in `LauncherRoot` (chain-4) — none of it here.

## `PromptScreen`

```ts
export interface PromptScreenProps {
  editing?: InstalledApp;          // present = re-prompt flow; absent = home tile's new-app flow
  initialText?: string;            // seeds the input (failure screen's "rephrase" preserves text)
  serverConfigured: boolean;       // design D3 — caller reads whim.server-url:v1, passes a bool
  onSubmit: (text: string) => void; // only ever called when serverConfigured is true
  onBack: () => void;
  onOpenSettings: () => void;
}
```
Own `BackHandler` (→ `onBack`) + `shellPalette(theme)`, matching `SettingsScreen`/`HistoryScreen`.
Submit is disabled (`canSubmit = serverConfigured && trimmed.length > 0`) and the input itself is
`editable={serverConfigured}` when no address is configured — the honest `COPY.
promptServerUnconfigured` message + `COPY.promptOpenSettings` link render instead of attempting a
request. Multiline, `autoFocus`, `COPY.promptDictationHint` rendered below the input.

## `RewritePreviewScreen`

```ts
export interface RewritePreviewScreenProps {
  originalPrompt: string;                 // shown small/muted, never editable
  rewrittenPrompt: string;                // seeds the editable TextInput
  onApprove: (text: string) => void;      // called with the CURRENT (possibly edited) text
  onBack: () => void;
}
```
Own `BackHandler` + `shellPalette(theme)`. `onApprove` always receives the live `text` state, not
`rewrittenPrompt` — callers must send that returned string as `GenerateRequest.prompt` per spec's
"user can edit the rewritten text" scenario.

## `GeneratingScreen`

```ts
type Stage = Extract<GenerationEvent, { type: 'stage' }>['stage']; // 'plan'|'generate'|'check'|'run'|'repair'

export interface GeneratingScreenProps {
  stage: Stage | null;   // null before the first `stage` event
  onCancel: () => void;  // hardware back AND the visible Cancel button both call this
}
```
`GenerationEvent` imported `import type` from `@whim/contract`. **Deviation from design.md's
literal `GenerationEvent['stage']` notation** (class A): `GenerationEvent` is a zod
`discriminatedUnion`, so indexing `['stage']` directly fails `tsc` (not every union member has a
`stage` field) — `Extract<GenerationEvent, {type:'stage'}>['stage']` yields the identical practical
type. Props carry ONLY `stage`/`onCancel` — no `token` text, no `diagnostic` field, by
construction (enforced by `prompt-flow-screens.suite.ts`, which asserts the props interface
declares no `token`/`diagnostic` member and the file never references `.kind`/`.symbol`/
`token.text`). Caller must never pass anything else in.

## `FailureScreen`

```ts
export interface FailureScreenProps {
  reason: string;                          // the terminal `failure` event's reason, or a plain
                                            // client/stream-error summary
  diagnostics: readonly { hint: string }[]; // hint-only — never kind/symbol/message
  onRephrase: () => void;                  // caller re-opens PromptScreen with initialText = the
                                            // preserved user text
  onDismiss: () => void;                   // caller returns to home
}
```
Own `BackHandler` (→ `onDismiss`) + `shellPalette(theme)`. Renders `reason` verbatim and each
`diagnostics[i].hint`; never any other `Diagnostic` field.

## New `COPY` keys (all in `src/host/launcher/copy.ts`, product-verbs-guard-clean)

`promptTitleNew`, `promptTitleEdit`, `promptPlaceholder`, `promptDictationHint`, `promptSubmit`,
`promptServerUnconfigured`, `promptOpenSettings`, `rewritePreviewTitle`,
`rewritePreviewOriginalLabel`, `rewritePreviewApprove`, `generatingTitle`, `generatingWaiting`,
`generatingStagePlan`, `generatingStageGenerate`, `generatingStageCheck`, `generatingStageRun`,
`generatingStageRepair`, `generatingCancel`, `failureTitle`, `failureHintsTitle`,
`failureRephrase`, `failureDismiss`.

## Test coverage added

`src/host/launcher/test/prompt-flow-screens.suite.ts` (registered in `acceptance.ts`) — static
source assertions mirroring `launch-failure-ui.suite.ts`'s idiom (these RN screens are not
rendered under Node): submit-gating, the unconfigured-server message, dictation-hint rendering,
rephrase text preservation, rewrite-preview edit semantics, the stage/hint-only prop shapes, and
that every new `COPY` key is a non-empty string. `product-verbs.suite.ts` already iterates every
`COPY` value, so the new strings are covered there with no edit to that file.

## Call-site expectations for chain-4

- None of these four components call `fetch`, touch `StoreAccess`, or hold `AbortController`
  state — all of that is chain-4's job in `LauncherRoot`'s handlers.
- `PromptScreen.onSubmit` is only reachable when `serverConfigured` is true — chain-4 does not
  need a second unconfigured-address guard before calling `rewritePrompt`.
- `GeneratingScreen`/`FailureScreen` props are the enforcement boundary for the "never leak
  internals" requirement — chain-4 must map `GenerationEvent`/`Diagnostic` down to exactly these
  shapes before handing them to these components, never wider.
