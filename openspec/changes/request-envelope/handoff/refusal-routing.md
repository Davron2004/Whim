# handoff/refusal-routing.md — chain-4 (device envelope) → chain-5 (update screen)

## From refusal code to screen

```ts
// src/host/launcher/service-refusal.ts (RN-free)
export interface RefusalRule {
  readonly landing: 'text' | 'sender';        // the flow step the user goes back to
  readonly tone: 'danger' | 'neutral';
  readonly opens?: 'consent' | 'update';      // a screen that replaces the notice
  readonly text?: string;                     // phone copy shown instead of the server hint
}
export const REFUSAL_RULES: { readonly [K in ServiceRefusalCode]: RefusalRule };
//   update_required:  { landing: 'sender', tone: 'neutral', opens: 'update',  text: COPY.updateRequiredLine }
//   consent_required: { landing: 'sender', tone: 'neutral', opens: 'consent', text: COPY.permissionRequiredLine }
//   the other seven: unchanged, no `opens`, no `text`
export function serviceRefusalOf(err: unknown): ServiceRefusal | undefined; // { code, hint, status?, retryAfterSeconds? }
export function refusalText(refusal: ServiceRefusal): string;               // rule.text ?? refusal.hint
```

`src/host/launcher/LauncherRoot.tsx`, inside `LauncherShell` (the hook):

```ts
const refusalScreen = (refusal: ServiceRefusal, back: Screen, resume: ConsentContinuation): Screen | undefined
```

- Returns the screen to open, or `undefined` when the refusal lands as a notice. Today only
  `opens === 'consent'` returns a screen; `'update'` returns `undefined`.
- Chain-5 adds its `update-required` branch here. Every caller already applies its own
  `onlyOnStep` guard, so a user who has left the step is never pulled onto the screen.
- Fallback until then: `update_required` lands as a sender/neutral notice reading
  `COPY.updateRequiredLine`, and a settled build's reason is that same text.

## Call sites (each builds `back` with the typed prompt intact, then `refusalScreen(...) ?? <notice landing>`)

| request | where | `back` | `resume` |
|---|---|---|---|
| clarify | `onComposeContinue` catch, guard `onlyOnStep('clarify')` | `composeStep(from.editing, from.text)` | `{ kind: 'resume', screen: back }` |
| rewrite | `openPlan` catch, guard `onlyOnStep('plan')` | `rewriteRefusalTarget(sentFrom, plan, refusal)` (compose or clarify, answers kept) | `{ kind: 'resume', screen: back }` |
| generate, fresh | `handleGenerateRefusal`, `outcome === 'drop'`, guard `onlyOnStep('build')` | `{ ...fromPlan, notice: undefined }` (edited rows kept) | `{ kind: 'resume', screen: back }` |
| generate, Retry | `handleGenerateRefusal`, `isRetry`, guard `onlyOnStep('build')` | `failureFromRecord(updated)` (record keeps `prompt`) | `{ kind: 'retry', record: updated }` |
| generate, detached | `handleGenerateRefusal`: `outcome === 'settle' && !isRetry` returns before any screen | none (user is elsewhere) | none |
| report | `ReportSheet.handleSend` refusal branch (`ReportSheet.tsx`) | none | none |

- Detached: the record settles `failed` with `refusalText(refusal)` as its reason and no screen
  opens. Chain-5 adds the update branch at that early return; there is no step to guard on.
- Report: `ReportSheet` shows a notice built with `refusalText`. It has no callback prop yet.
  Chain-5 adds one and wires it for all three sheets: the done step's and history's (both in
  `LauncherRoot`) and the orb's (inside `MiniAppView`, which would need a prop from `LauncherRoot`).
  To detect the case, check `REFUSAL_RULES[refusal.code].opens === 'update'`.
- A dropped fresh attempt is deleted before the screen opens, and `back` is the plan it was
  started from.

## Where `consent_required` goes (done, chain-4)

```ts
// Screen arm (LauncherRoot.tsx)
{ kind: 'consent'; mode: 'ask'; continuation: ConsentContinuation; returnTo: Screen; outdated: boolean; refused?: boolean }
// src/host/launcher/consent-flow.ts
export type ConsentContinuation =
  | { kind: 'compose'; editing?: InstalledApp }
  | { kind: 'retry'; record: PendingBuildRecord }
  | { kind: 'resume'; screen: ComposeScreen | ClarifyScreen | PlanScreen };
```

- `refusalScreen` returns the ask-mode screen with `refused: true`, `returnTo: back` and
  `continuation: resume`. `ConsentScreen` then shows `COPY.permissionRequiredLine`.
- `Not now` goes to `declineTarget(back)`. `Agree and continue` grants, then `runContinuation`:
  `resume` calls `setScreen(screen)`, so the user sends it again, and `retry` re-runs the record.

## Preserving the typed prompt

`back` is always the sending step rebuilt without a notice. The prompt lives in
`ComposeScreen.text`, `ClarifyScreen.text`/`answers`, `PlanScreen.text`/`rows`, or
`PendingBuildRecord.prompt`. D5 says the update screen's "Not now" goes home. Keeping `back` (for
example as the screen's own `returnTo`) is chain-5's call; home-then-compose loses the text.

## Test seams

- `export default function LauncherRoot({ appInfo = installedAppInfo }: Readonly<{ appInfo?: () => AppInfo }>)`
  is the only way to hand the shell a build number under the launcher runner. That runner has no
  native module, so the real seam throws there. `rendered-launcher.tsx`: `withLauncher({ appInfo?, ... })`,
  default `testAppInfo` (`test/client-fixtures.ts`, iOS `1.4.0` build `381500`), plus `SentRequest.headers`
  and `Launcher.probes` (the `/healthz` headers).
- Revise `test/request-envelope-ui.suite.tsx` › "update_required on clarify: recognised…". It pins
  today's notice fallback.
