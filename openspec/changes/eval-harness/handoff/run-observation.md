# Handoff: run-observation (chain-B → C, E)

Implemented in `evals/adapters/synthetic-run.ts`, `evals/tiers/tier-a.ts`, `evals/tiers/case.ts`.
`RunObservation`/`ContainmentVerdict`/`TierAResult` themselves are `evals/contract.ts` (chain-A) —
this handoff pins how chain-B *produces* and *gates on* them, not new types.

## The vantage flag (F4) — what chain-C's assertions and Tier A both trust

`RunObservation.containment.authenticated` is `true` **only** when the containment verdict came
from the nonce-authenticated observation vantage. A candidate self-report is never adopted — Tier
A treats `authenticated: false` as an outright failure, never a pass, regardless of `contained`'s
value. Chain-C's assertions may read `RunObservation` freely but MUST NOT re-derive trust from
any field other than this one; it is the single source of truth for "was this verdict real".

## The adapter — `evals/adapters/synthetic-run.ts` (the ONLY module importing synthrun)

```ts
export function observationFromRunReport(caseId: string, report: RunReport): RunObservation;
```
`RunReport` is `synthrun/contract.ts`'s type (design D6 — imported here only). Field mapping:
- `diagnostics`: `report.diagnostics`, each widened to `Diagnostic` (`checks/contract.ts`) by
  defaulting a missing `line` to `0` — `0` is never a real 1-based source line, so it reads
  unambiguously as "no source anchor" (a runtime producer, e.g. a gate denial or `mount_timeout`,
  may have none). `kind`/`severity`/`message`/`hint` pass through verbatim.
- `declaredScreens` / `reachedScreens`: `report.screens.declared` / `.visited`, verbatim.
- `syscallsInvoked` / `cuesInvoked`: `report.trace` filtered by `entry.kind === 'syscall'` /
  `'cue'`, mapped to `entry.method`. `'denial'` trace entries are not surfaced here — they already
  reach `RunObservation.diagnostics` via `report.diagnostics` upstream (synthrun's own
  `report.ts`), so this adapter never double-reports them.
- `containment`: `{ authenticated: true, contained: report.contained }` — **always**
  `authenticated: true`. `report.contained` is itself derived only from the nonce-authenticated
  `probes` frame by construction (synthrun's `report.ts`/`observe.ts`: never adopted from
  elsewhere), so every real synthetic-run report is authenticated by definition.
  `authenticated: false` can only appear on a **hand-built** `RunObservation` — used to exercise
  Tier A's untrusted-verdict path in tests, never produced by this adapter.
- `caseId`: supplied by the caller (`RunReport` carries no case identity of its own).

## Tier A — `evals/tiers/tier-a.ts`

```ts
export function evaluateTierA(source: string, observation: RunObservation): TierAResult;
```
Pure function of its two inputs (same source + same observation ⇒ equal result, field for field).
`diagnostics` on the result is `runStaticChecks(source).diagnostics` concatenated with
`observation.diagnostics`, in that order — static leg first, runtime leg second. `status` is
`'pass'` iff: no diagnostic in that combined list has `severity === 'error'`, **and**
`observation.containment.authenticated && observation.containment.contained`. `containment` on
the result is `observation.containment`, echoed verbatim — the untrusted-verdict failure is
visible there (`authenticated: false`) without minting any new diagnostic kind. A boot/mount
failure needs no special case: it always arrives as an `error`-severity diagnostic on
`observation.diagnostics` (`mount_timeout`, `run_truncated`, `runtime_throw`, ...).

## Case verdict — `evals/tiers/case.ts`

```ts
export function tierAFailed(tierA: TierAResult): boolean;               // tierA.status === 'fail'
export function computeCaseVerdict(tierA: TierAResult, tierB: TierBResult): 'pass' | 'fail';
```
`tierAFailed` is the one flag an orchestrator (not yet written — chain-F's CLI) uses to decide
whether to call `evaluateTierB`/Tier C's `evaluateTierC` at all, or short-circuit both straight to
`skipped: 'tier_a_failed'` — the same convention `evals/tiers/tier-c.ts`'s `TierCInput.tierAFailed`
already implements; chain-C's `evaluateTierB` MUST accept the same flag. `computeCaseVerdict`
takes **no `TierCResult` parameter at all** — Tier C is structurally incapable of influencing the
verdict. Fails when Tier A failed, or `tierB.status === 'skipped'`, or any assertion in
`tierB.assertions` has `status === 'fail'`; passes otherwise (vacuously, if `assertions` is
empty).

## Fixtures chain-C/E may reuse

- `evals/test/fixtures/candidates/honest.app.tsx` — zero static diagnostics.
- `evals/test/fixtures/candidates/error-diagnostic.app.tsx` — one `forbidden_global` error.
- `evals/test/fixtures/synthetic-run-report.json` — a hand-authored, schema-complete `RunReport`
  (one `Home` screen, two `storage.*` syscalls, one `cues.haptic` cue, contained, not truncated).
