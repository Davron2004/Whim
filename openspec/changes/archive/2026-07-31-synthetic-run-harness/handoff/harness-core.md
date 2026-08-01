# Handoff: harness-core (chain 1 — core-builder-session)

Library root: `synthrun/` (plain top-level dir, `checks/`-style, no workspace entry — D5).
Files: `contract.ts` (types), `builder.ts` (candidate esbuild), `page.ts` (page assembly),
`session.ts` (Chromium lifecycle), `concurrency.ts` (semaphore), `env.d.ts` (no `@types/node`
dep — mirrors `src/host/storage-engine/env.d.ts`), `index.ts` (barrel).

## Entry-point + options types (`contract.ts`)

```ts
export type RuntimeDiagnostic = Omit<StaticDiagnostic, 'line'> & { line?: number }; // StaticDiagnostic = checks/contract.ts Diagnostic
export interface TraceEntry { kind: 'syscall' | 'cue' | 'denial'; method: string; atMs: number; } // chain 3 extends into a discriminated union
export interface RunBudgets { mountBudgetMs: number; actionQuietMs: number; actionHardCapMs: number; totalBudgetMs: number; } // shape only — chain 2 (D2) owns defaults
export interface StageTimings { buildMs: number; bootMs: number; mountToPaintMs: number; sweepMs: number; perScreenMs: Record<string, number>; }
export interface Semaphore { acquire(): Promise<() => void>; }
export interface RunOptions { budgets?: Partial<RunBudgets>; appId?: string; }
export interface RunReport {
  ok: boolean; diagnostics: RuntimeDiagnostic[]; contained: boolean; truncated: boolean;
  timings: StageTimings; trace: TraceEntry[]; screens: { declared: string[]; visited: string[] };
  budgets: RunBudgets;
}
export type RunCandidate = (source: string, opts?: RunOptions) => Promise<RunReport>;
```

**Deviation from a literal spec reading (Class A):** the spec's "options (budgets, concurrency
handle)" wording is read as: concurrency is SESSION-scoped (design D4 — "one long-lived
Chromium browser per session... bound concurrent runs with a caller-set semaphore"), not
repeated per call. `RunOptions` therefore carries only run-scoped knobs; the "concurrency
handle" is `SessionOptions.semaphore`/`concurrency` below.

`RunCandidate` is declared as a TYPE only in chain 1 — no function implements it yet. Chain 5
(task 5.2) assembles the real one by composing observation (chain 2) + capability wiring
(chain 3) + the sweep (chain 4) on top of `SynthRunSession.openRun` below.

## Page assembly (`page.ts`)

```ts
export interface RuntimeParts { neutralize: string; reactInject: string; resolver: string; sdkInject: string; probes: string; syscall: string; loader: string; }
export function loadRuntimeParts(): Promise<RuntimeParts>; // reads runtime-artifacts.json, cached, read-only
export function assembleCandidatePage(candidateJs: string, candidateName?: string): Promise<string>;
```

`assembleCandidatePage` calls `buildSrcdoc`/`buildOuterHtml` (`build/assemble.mjs`) UNMODIFIED:
`channel: 'b'`, `showDiagnostics: false`, `syscallSink: 'exposed'` — the last is the seam chain 3
attaches `page.exposeFunction('whimHostDispatch', host.dispatch)` to (bridge-invariants recipe).

## Candidate builder (`builder.ts`)

```ts
export interface BuildCandidateResult { js: string; map: string; }
export function buildCandidateFile(entryPath: string): Promise<BuildCandidateResult>;
export function buildCandidateSource(source: string, opts?: { filenameHint?: string }): Promise<BuildCandidateResult>;
```

`buildCandidateFile` mirrors `build/build.mjs`'s `bundleApp` esbuild call field-for-field
(IIFE, classic JSX, externals `{vc-sdk,react,react-dom,react-dom/client}`, `tsconfigRaw:'{}'`,
`inject:[build/react-inject-shim.ts]`). Pinned byte-identical to the checked-in
`build/generated/tip-splitter.app.js` by `synthrun/test/acceptance.ts` (drift tripwire, refreshed
every gate run by `npm run build`). `buildCandidateSource` writes to a uniquely-named temp file
(safe under concurrency — filename only affects internal esbuild identifiers, never behavior)
and delegates to `buildCandidateFile`.

## Session / context lifecycle (`session.ts`)

```ts
export interface SessionOptions { concurrency?: number; semaphore?: Semaphore; } // default concurrency 4
export interface RunContext { runId: string; appId: string; page: Page; context: BrowserContext; startedAt: number; timings: Pick<StageTimings,'buildMs'|'bootMs'>; }
export interface OpenRunResult { ctx: RunContext; dispose(): Promise<void>; }
export class SynthRunSession {
  static launch(opts?: SessionOptions): Promise<SynthRunSession>;
  openRun(source: string, opts?: RunOptions): Promise<OpenRunResult>;
  close(): Promise<void>;
}
```

One `chromium.launch()` per `SynthRunSession` (D4). `openRun`: acquires the session semaphore →
builds the candidate → assembles the page → opens a FRESH `browser.newContext()` + page →
navigates (`waitUntil:'load'`) → returns `{ctx, dispose}`. Caller MUST call `dispose()` exactly
once (closes context+page, releases the semaphore slot) when the run's report is complete.
Smoke-verified end-to-end against real headless Chromium: candidate renders inside the iframe,
two concurrent `openRun` calls get distinct `runId`/`context`, and a slot releases correctly on
`dispose()`.

## Where later chains plug in

- **Chain 2 (observation/watchdog):** attach `page.on('console'|'pageerror')` and the
  nonce-frame listener to `ctx.page` right after `openRun` returns, before driving anything.
- **Chain 3 (capability wiring):** needs `context.exposeFunction('whimHostDispatch', ...)`
  bound BEFORE navigation (inline scripts run on load) — this means chain 3 must EXTEND
  `openRun` itself (e.g. an `opts.exposeBefore` hook) rather than layering it on after the
  call returns; `page.ts` already sets `syscallSink:'exposed'` expecting this.
  `ctx.appId` is the ephemeral storage-engine `appId` scope to launch the app under (D3).
  `ctx.runId` doubles as `buildCandidateSource`'s `filenameHint`.
- **Chain 4 (sweep):** drives `ctx.page` via CDP/Playwright directly.
  Screen coverage uses `page.evaluate(() => globalThis.__whimControl.reinject({reset:true,...}))`.
- **Chain 5 (report assembly):** composes chain 2/3/4 outputs + `ctx.timings` into `RunReport`;
  calls `dispose()` when done. `RunBudgets` defaults are chain 2's to set (D2); chain 1 leaves
  no defaults in `contract.ts`, only the shape.
