# handoff: chain-D — the shell's routes after the `2a` restructure

Interface only. Source of record: `src/host/launcher/LauncherRoot.tsx` (the union + orchestration),
`src/host/launcher/prompt-flow.ts` (the pure machine), `src/host/launcher/prompt-envelope.ts`.

## The `Screen` union

```ts
type Screen =
  | { kind: 'home' }
  | { kind: 'app'; app: InstalledApp; record: AppRecord; source: string; engineAppId: string }
  | { kind: 'dev' }
  | { kind: 'settings' }
  | { kind: 'history'; app: InstalledApp }
  | FlowScreen                       // the five steps of `2a`, from prompt-flow.ts
  | { kind: 'failure'; editing?: InstalledApp; prompt: string; reason: string;
      diagnostics: readonly { hint: string }[] };
```

`prompt` / `rewrite-preview` / `generating` are GONE, together with `PromptScreen.tsx`,
`RewritePreviewScreen.tsx`, `GeneratingScreen.tsx` and their `COPY` keys (`prompt*` except
`promptServerUnconfigured`/`promptOpenSettings`, `rewritePreview*`, `generating*`, plus
`createTileLabel`/`emptyBody`, whose affordances the `2a` home replaced).

## `FlowScreen` (verbatim, `prompt-flow.ts`)

```ts
type FlowStep = 'compose' | 'clarify' | 'plan' | 'build' | 'done';
interface FlowQuestion { id: string; question: string; options: readonly string[] }
interface FlowPlanRow  { label: string; text: string }   // label '' = the single-row fallback
type FlowAnswers = Readonly<Record<string, string>>;

ComposeScreen { kind:'compose'; editing?; text }
ClarifyScreen { kind:'clarify'; editing?; text; questions; answers }
PlanScreen    { kind:'plan';    editing?; text; questions; answers; rewritten; rows; loading }
BuildScreen   { kind:'build';   editing?; text; rewritten; answers; questions; stage; delivering }
DoneScreen    { kind:'done';    editing?; app: InstalledApp }
```

`editing` absent = the new-app flow (home composer row); present = the per-app "Prompt again" /
History "Change it from here" edit flow. `text` is always the user's VERBATIM prompt; `rewritten`
is what generation is asked for.

## Transitions — pure, all in `prompt-flow.ts`

```ts
composeStep(editing?, text?)                          -> ComposeScreen
acceptClarifyQuestions(ClarifyQuestion[] | undefined) -> FlowQuestion[]   // ≤3, drops optionless
stepAfterClarifyExchange(questions)                   -> 'clarify' | 'plan'  // 0 questions => plan
isClarifySkip(err)                                    -> boolean          // a clarify 502 only
clarifyStep(compose, questions) / withAnswer(clarify, id, answer)         // single-select, never clears
clarificationsFrom(questions, answers)                -> Clarification[]  // answered only, by value
planStep(compose | clarify)                           -> PlanScreen  (loading, rows [])
withPlan(plan, RewriteResponse)                       -> PlanScreen  (rows, loading false)
planRowsFrom(RewriteResponse)                         -> FlowPlanRow[]    // absent/empty plan => 1 row
reopenCompose(plan, row)                              -> ComposeScreen prefilled with row.text
buildStep(plan) / withStage(build, stage) / withDelivering(build)
doneStep(build, delivered)                            -> DoneScreen
backFrom(screen)                  -> FlowScreen | 'home' | null  // build/done: null
primaryActionLabel(step, busy)    -> 'One moment' | 'Build it' | 'Continue'
BUILD_STEPS / buildStepStatuses(stage, delivering) / currentActionSentence(stage, delivering)
```

Stage → named step: `plan`→0, `generate`→1, `check`/`run`/`repair`→2, delivering→3.

## Which component each step routes to

| screen | component | props |
|---|---|---|
| compose | `ComposeStep` | `text, serverConfigured, busy, onChangeText, onContinue, onBack, onOpenSettings` |
| clarify | `ClarifyStep` | `prompt, questions, answers, busy, onAnswer, onContinue, onBack` |
| plan | `PlanStep` | `rows, loading, onEditRow, onBuild, onBack` |
| build | `BuildStep` | `stage, delivering, onLeaveRunning, onCancel` |
| done | `DoneStep` | `app, onOpen, onBackToApps` |
| home | `HomeScreen` | unchanged props; `onCreate`/`onPromptAgain` open compose |
| history | `HistoryScreen` | + `onChangeIt={(app) => openCompose(app)}` |

Shared chrome: `flow-chrome.tsx` (`FlowHeader`, `PrimaryAction`). Skeletons: `flow-skeletons.tsx`
(`BreathingView`, `HomeGridSkeleton`); the plan-row skeleton lives in `PlanStep.tsx` beside the
geometry it reuses (`PLAN_ROW_MIN_HEIGHT`/`PLAN_ROW_RADIUS`/`PLAN_ROW_GAP`, all exported).

## Two behaviours worth not re-deriving

- **`Leave it running` ≠ cancel.** It sets `detached` on the in-flight controller and goes home;
  the run finishes and still delivers, silently. HARDWARE BACK out of the build step is the
  separate, older contract (`prompt-flow` "Leaving generation cancels the in-flight request
  cleanly"): abort, install nothing, return to compose with the text preserved.
- **The plan step opens before its rows exist** (`loading: true`, skeleton rows, primary action
  busy) — that is the one place rows are genuinely coming with a known shape. Compose's own action
  stays busy across the clarify call, because a question list has no known shape to stand in for.

## The prompt envelope (`prompt-envelope.ts`)

```ts
export const PROMPT_ENVELOPE_VERSION = 2;
export function promptEnvelope(text: string, summary?: RunSummary): string; // {v:2,text,summary?}
export function parsePromptEnvelope(raw: string): { text: string };         // v1, v2, raw string
```

`text` is the verbatim approved prompt; `summary` is written only when the terminal `result`
carried one. `parsePromptEnvelope` accepts v1 and v2 and falls back to the raw string for anything
else (an unknown future version included) — never throws, never migrates. The summary is read back
structurally by `history-logic.ts#storedSummary`, not by this module. The lineage stamp stays a
commit trailer, outside the envelope.
