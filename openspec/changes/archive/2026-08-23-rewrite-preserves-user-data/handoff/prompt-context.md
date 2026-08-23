# handoff: prompt-context (chain-3 → chain-4)

Interface only. Source of truth: `server/src/generation/prompts/index.ts`,
`server/src/generation/machine.ts`.

## Turn contexts (verbatim)

Every builder takes one context object plus, for the two code-writing turns, the `PromptInputs`
loaded at composition-root time. Fields added by this chain are marked NEW.

```ts
export interface RewriteTurnContext {
  request: RewriteRequest;              // chain-4 extends this request shape, not this interface
}

export interface PlanTurnContext {
  request: GenerateRequest;
  schemaContext: string;
  storageSurface?: string;              // NEW
  priorFailureReason?: string;          // set only on a plan re-ask
}

export interface GenerateTurnContext {
  request: GenerateRequest;
  plan: PromptPlan;
  schemaContext: string;
  storageSurface?: string;              // NEW
}

export interface RepairTurnContext {
  request: GenerateRequest;
  plan: PromptPlan;
  currentSource: string;                // the FAILING CANDIDATE, not the app being edited
  diagnostics: Diagnostic[];            // errors-first, ordered by the caller
  schemaContext: string;
  storageSurface?: string;              // NEW
}

export function buildRewriteMessages(ctx: RewriteTurnContext): ModelMessage[];
export function buildClarifyMessages(ctx: ClarifyTurnContext): ModelMessage[];
export function buildPlanMessages(ctx: PlanTurnContext): ModelMessage[];
export function buildGenerateMessages(ctx: GenerateTurnContext, inputs: PromptInputs): ModelMessage[];
export function buildRepairMessages(ctx: RepairTurnContext, inputs: PromptInputs): ModelMessage[];
export function buildSummaryMessages(input: SummariserInput): ModelMessage[];
```

`schemaContext` and `storageSurface` are **pre-rendered strings**, both produced once per run by
`machine.ts` (below). A builder never scans, never reads disk, never sees a model id.

## Section helpers (module-private, in render order)

| helper | rendered when | heading it emits |
| --- | --- | --- |
| `clarificationsSection(clarifications?)` | list non-empty | `The user already answered these questions…` |
| `requestEditSection(request, sourceRendered)` | always | brand-new / edit / honest-regeneration line + `Current manifest:` + `Current schema:` |
| `currentSourceSection(source)` | generate: pre-flighted `app.source` present; repair: always | `Current source:` |
| `identityContinuitySection(request)` | `request.app` present | `Continuity — this app already exists…` |
| `storageSurfaceSection(storageSurface?)` | string non-empty | `Storage locations the app being edited reads and writes:` |
| `planSection(plan)` | generate/repair | `Validated plan:` |
| `schemaContextSection(schemaContext)` | string non-empty | `Storage field-ID constraints:` |
| `diagnosticsSection(diagnostics)` | repair | `Diagnostics to fix, errors first, verbatim:` |
| `fewShotSection` / `sdkReferenceSection` | generate/repair, system message | — |

`nonEmptySections(...parts)` joins with a blank line, dropping every blank part — that is how an
absent section disappears rather than leaving a dangling heading. **Add new sections through it.**

## Invariants a later chain must not break

- **The prompt never claims what it does not carry.** `requestEditSection`'s
  "included below under \"Current source\"" sentence is emitted ONLY when the same turn goes on to
  render `currentSourceSection` — that is the whole purpose of the `sourceRendered` argument. The
  plan turn passes `false` (design D2: it does not need the source and will not pay for it twice).
- **`app.source` reaching a builder is already pre-flighted** by the composition root
  (`preflightSource`). "Present" therefore means real, parseable source declaring a default-exported
  `defineApp` — a builder must not re-validate it, and `undefined` means honest regeneration.
- **Identity continuity is keyed on `request.app`, not on `app.source`** — an honest regeneration
  must preserve the name and burned ids just as much as a source-carrying edit. The source block and
  the storage-location list are keyed on the source.
- **A new app (`request.app` undefined) carries none of the three continuity instructions.**
- **`storageSurface` is rendered from the run's single `scanStorageSurface` result** and the same
  scan is handed to the check stage as `previousSurface` (design D3, one scanner two consumers).
  Do not scan in a builder, and do not hand-build the list.

## What `machine.ts` derives per run (unexported; do not duplicate)

```ts
interface EditContext {
  schemaContext: string;        // schemaContextFor(request)
  storageSurface: string;       // storageSurfaceFor(previousSurface) — "- kv key \"x\"" one per line
  previousSurface?: StorageSurface;  // scanStorageSurface(pre-flighted app.source)
}
```

`editContextFor(request)` is called ONCE in `runGenerator`, before the plan turn, and the same
object is threaded to the plan / generate / repair turns and to `CheckStage.check`'s `CheckContext`.
`schemaContextFor` states the per-collection floor numerically via the storage engine's exported
`burnedIdFloor` and asks the model to KEEP existing ids — it must never re-derive a floor locally,
and must never tell the model to avoid the existing ids.
