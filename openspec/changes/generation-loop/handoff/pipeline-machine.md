# Handoff: plan-and-state-machine (chain-4)

## `server/src/generation/machine.ts` — the state machine and its injected seams

```ts
export interface Clock { now(): number }   // reserved for future instrumentation; the machine
                                            // does not branch on it — a fake may return anything.

export interface CheckedManifest { name: string; manifest: Record<string, unknown>; schema: Record<string, unknown> }
export interface CheckReport { diagnostics: Diagnostic[]; manifest?: CheckedManifest }
export interface CheckContext { appliedSchema?: Record<string, unknown> }
export interface CheckStage {
  check(source: string, ctx: CheckContext, signal?: AbortSignal): Promise<CheckReport> | CheckReport;
}
// No `ok`/severity-gate field: the checker API grows no severity knob (D6) — the machine alone
// decides errors-block / warnings-pursued from `diagnostics[].severity`.

export interface BuildResult { bundle: string; sourceMap?: string }
export type BuildOutcome = { ok: true; result: BuildResult } | { ok: false; diagnostic: Diagnostic };
export interface BuildStage {
  build(source: string, signal?: AbortSignal): Promise<BuildOutcome> | BuildOutcome;
}
// A builder throw is mapped by the CONCRETE stage to one `build_failure` error diagnostic (task
// 5.4) — the machine treats it exactly like a check-stage error, feeding it through the same
// repair loop, never as a bare internal error.

export interface RunInput { source: string; manifest?: CheckedManifest; build: BuildResult }
export type RunOutcome =
  | { contained: false; diagnostics: Diagnostic[] }
  | { contained: true; diagnostics: Diagnostic[]; record: WireAppRecord };
export interface RunStage {
  run(input: RunInput, signal?: AbortSignal): Promise<RunOutcome> | RunOutcome;
}
// `contained: false` is TERMINAL (D7): `diagnostics` is ignored entirely, no repair attempt is
// consumed, nothing is fed back to the model. When `contained` is `true`, `record` is ALWAYS
// present (the harness-validated `WireAppRecord`, D12) regardless of `diagnostics` — the MACHINE
// decides whether to deliver it or keep repairing (D6), never the stage. The concrete `RunStage`
// is therefore the one place that assembles `WireAppRecord` (from `CheckedManifest` + `BuildResult`
// + a validated bundle) — `record.ts` (chain-5) is a helper the concrete stage calls, not
// something `machine.ts` invokes; machine.ts never re-derives or re-parses a record.

export interface RunTrace { generationIds: string[] }   // D9: appended as each model call resolves.

export interface PipelineBounds { planAttempts: number; repairAttempts: number; warningRepairAttempts: number }
export const DEFAULT_BOUNDS: Readonly<PipelineBounds>; // { planAttempts: 2, repairAttempts: 3, warningRepairAttempts: 1 }

export interface GenerationPipelineDeps {
  model: ModelClient; roster: ModelRoster;
  promptInputs: PromptInputs;   // loaded once at composition-root time (D10) — never read from disk here
  check: CheckStage; build: BuildStage; run: RunStage; clock: Clock;
  bounds?: Partial<PipelineBounds>;
}

export class GenerationMachine {
  constructor(deps: GenerationPipelineDeps);
  run(request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent>;
}
```

## Budget semantics (D4/D6)

- `planAttempts` (default 2): the initial ask + at most one re-ask. Exhaustion → one `failure`,
  `attempts: 0` (no candidate was ever produced), `diagnostics: []`. Never emits `generate`.
- `repairAttempts` (default 3): the total repair-round budget — every `CHECK`/`BUILD`/`RUN` error
  outcome that triggers `REPAIR` decrements it. Exhaustion → `failure` with `attempts` = candidates
  produced (initial + repairs, at most 4) and `diagnostics` = every diagnostic streamed this run.
- `warningRepairAttempts` (default 1): a candidate with diagnostics but **no** `severity: 'error'`
  entry may consume at most this many of `repairAttempts` chasing the warnings. Once spent, a
  still-warnings-only candidate proceeds straight to `BUILD`/`RUN` and, if green, is **delivered**
  with the residual warnings already streamed as `diagnostic` events (D6) — this is not a failure.
- Containment (`RunOutcome.contained === false`) is terminal immediately: no repair attempt is
  spent, `failure.diagnostics` is `[]`.

## Event ordering contract (over the closed `GenerationEvent` union — no additions)

- `stage` `start`/`done` bracket every `plan|generate|check|run|repair`. `BUILD` has no stage of
  its own — it is folded inside the `run` bracket (build first, then run, one `start`/`done` pair).
- `attempt` appears ONLY on a repair round's `repair`/`check`/`run` events (1-based, `repairsUsed`
  after incrementing); `plan`/`generate` and the initial round's `check`/`run` never carry it.
- `token` events stream per model-stream delta during `generate` and `repair` only — never `plan`.
- `diagnostic` events fire as each `CheckReport`/`BuildOutcome`/successful-`RunOutcome` diagnostic
  is observed, before that stage's `done` — except a `contained: false` `RunOutcome`, whose
  diagnostics are never streamed or accumulated (D7).
- Exactly one `usage` event (accumulated totals across every model call) immediately precedes the
  one terminal event (`result` | `failure`). No terminal event is ever emitted on abort.
- An unexpected thrown exception from any stage/model call (not an abort) is caught once and
  becomes a single generic `failure` (`reason` never contains the exception text).

## Plan (`server/src/generation/plan.ts`)

```ts
export interface Plan { screens: {name:string; purpose:string}[]; initial:string; state:string[]; capabilities:string[]; storageKeys:string[] }
export function parsePlan(text: string): { ok: true; plan: Plan } | { ok: false; reason: string };
export function validatePlan(plan: Plan, request: GenerateRequest): { ok: true } | { ok: false; reason: string };
```

`Plan` is structurally identical to `prompts/index.ts`'s `PromptPlan` (no import either direction).
Known capabilities = `checks/contract.ts`'s `CAPABILITY_EXPORTS` capability set (`storage`, `cues`)
— matches `PLAN_SYSTEM`'s prompt text verbatim; the bridge registry's `diag` capability has no SDK
facade and is not model-generatable here, so it is deliberately excluded. The plan never crosses
the wire; `validatePlan`'s reason strings are quotable product prose, never raw model text.
