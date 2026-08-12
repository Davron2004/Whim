# Contract — the run report's containment verdict and forgery signal (chain-3)

`synthrun/contract.ts` + `synthrun/observe.ts` + `synthrun/report.ts`. Read this before consuming,
constructing, or fixturing a `RunReport`. Everything a consumer needs is here.

## The widened verdict (verbatim, BREAKING)

```ts
export interface RunReport {
  ok: boolean;                    // `true` IFF diagnostics.length === 0 — unchanged
  diagnostics: RuntimeDiagnostic[];
  contained: boolean | null;      // ← was `boolean`
  forgeries: ForgeryTally;        // ← new, REQUIRED
  truncated: boolean;
  timings: StageTimings;
  trace: TraceEntry[];
  screens: { declared: string[]; visited: string[] };
  budgets: RunBudgets;
}
```

`contained` is three-valued and is emitted from `ObservationState.contained` **verbatim** — the
harness never collapses `null` onto `false`, onto `true`, or onto any other single value:

| value | meaning | accompanying diagnostic |
| --- | --- | --- |
| `true` | a nonce-authenticated `probes` frame reported containment held | none from this axis |
| `false` | a nonce-authenticated `probes` frame reported a breach | exactly one `containment_failure` |
| `null` | no authenticated verdict was ever observed — no `probes` frame arrived, or the one that did carried no boolean `payload.contained` | exactly one `containment_unobserved`, and **never** a `containment_failure` |

Guarantees a consumer may rely on:

1. `null` never travels without its diagnostic. `report.ts` calls `finalizeContainmentVerdict(obs.state)`
   at composition, before diagnostics are copied, so every `contained === null` report carries
   `containment_unobserved`.
2. `containment_unobserved` appears **at most once** per report (both emission sites go through one
   deduplicating minter).
3. `containment_failure` requires an explicit `false`. A malformed/absent verdict field is absence
   of evidence, not a breach.
4. `mount_timeout` and `containment_unobserved` are independent: a run may carry both (never
   painted AND never verified), or `containment_unobserved` alone (painted, then no verdict). One
   is never a substitute for the other — see `handoff/diagnostic-kind.md`'s no-substitution rule.
5. Because `containment_unobserved` is a diagnostic, an unobserved run has `ok === false`.

`ObservationState.contained` (observe.ts) is already and still `boolean | null` with the same three
meanings; only the report's field changed type.

## What does NOT force a compile error (chain-5, read this)

Widening to `boolean | null` makes a consumer that *assigns* `contained` to a `boolean` fail to
compile (measured: `evals/adapters/synthetic-run.ts:36`). It does **not** make an existing
`report.contained === false` comparison fail — that stays legal TypeScript and silently keeps
treating "unobserved" as "not a breach, proceed". `server/src/generation/stages/run.ts` and
`machine.ts` therefore compile unchanged and must be corrected deliberately (tasks 5.1/5.2), not
by chasing tsc output.

## The forgery signal

```ts
export const REJECTED_FORGERY_CAP = 16;

export interface ForgeryTally {
  rejected: boolean;   // at least one frame was rejected as a forgery during this run
  count: number;       // rejections observed, SATURATING at REJECTED_FORGERY_CAP
}
```

- `count === REJECTED_FORGERY_CAP` reads as **"at least 16"**, never as exactly 16. Rejections
  beyond the cap are not recorded individually, so the signal is fixed-size no matter how many
  frames a candidate posts.
- `rejected === (count > 0)`. `count === 0` ⟺ `rejected === false`.
- Source: `ObservationState.rejectedForgeries`, incremented on each untrusted `rejected-forgery`
  frame the outer page relays. The frame's `payload` is never read on that path.
- A rejected forgery is **not** a diagnostic and does not affect `ok`, `contained`, or any verdict.
  A candidate that forges a verdict and is also genuinely contained still reports `contained: true`.
- The tally is **not a hostility discriminator**. It counts every rejection, including the
  harness's own T6b pen test: `src/runtime/web/probes.js` posts an unauthenticated
  `{__whimHarness:true, kind:'spoof-probe'}` frame from **every** realm, and `assemble.mjs`
  rejects it as `rejected-forgery`. So a perfectly clean candidate reports `rejected: true` and
  `count >= 1` on every run that reaches the oracle, and the count rises further with realm resets
  (`synthrun/sweep.ts`'s `reinject({reset:true})` re-runs the oracle per reset). What it IS good
  for: a bounded, payload-free record that forgery rejection is happening at all, and a saturating
  count that separates ordinary operation from a candidate flooding the channel.

## Invariant: payload-free, and never model-facing

No byte of a forged frame reaches any `RunReport` field, any diagnostic (`message` or `hint`), or
any harness log line. A forged frame's contents are attacker-chosen input: echoing them would let
the candidate author our diagnostics, and an unbounded list would be a log-exhaustion lever.
Neither the forgery tally nor the `containment_unobserved` diagnostic may be routed into a
model-facing path (a repair prompt, a regenerate prompt, any assembled LLM input) — a
candidate-influenced string reaching the repair loop is a prompt-injection channel.

`ObservationState.events` is an internal observation buffer, not a report field: it still carries
each frame's raw `payload` (including a rejected forgery's), and is the ONE place a forged payload
exists. It is never copied onto the report. Do not forward it into anything model-facing, a
persisted artifact, or a log.

## Constructing a `RunReport` (fixtures, stubs)

Both new obligations are compile-enforced: `forgeries` is required, and `contained` must be
explicitly one of three values. A stub that means "we saw a clean run" is
`{ contained: true, forgeries: { rejected: false, count: 0 }, ... }`; "we never heard back" is
`{ contained: null, forgeries: { rejected: false, count: 0 }, diagnostics: [containment_unobserved], ok: false, ... }`.

`ObservationState` gained a required `rejectedForgeries: number` too — a hand-built state literal
(e.g. a test stub) must initialise it to `0`.
