# Contract: greenBy phased-TDD harness (Chain B writes · C/D/E consume)

The checks suite is authored **tests-first**: Chain B writes the FULL assertion corpus for
chains B–E up front (all initially red), each test tagged with the chain that must turn it
green. Later chains implement code until their tagged tests pass. This lets the contract be
pinned before any implementation, so a green is meeting an independently-written bar — not
teaching-to-the-test. (Chain F's hostile corpus is NOT pre-authored here: the §16.4 separate
session authors its own black-box tests against the finished `runStaticChecks`; they run
strict, see below.)

## The `test()` signature (frozen after Chain B)

```ts
type Chain = 'B' | 'C' | 'D' | 'E';            // pre-authored, ordered B<C<D<E
type TestOpts = { greenBy: Chain };
function test(name: string, opts: TestOpts, fn: () => void | Promise<void>): Promise<void>;
function test(name: string, fn: () => void | Promise<void>): Promise<void>; // legacy = greenBy 'B'
```

A test throws to fail (house idiom, `src/host/bridge/test/acceptance.ts`). Untagged ⇒ `greenBy:'B'`
(due immediately) — a forcing function: an un-tagged assertion fails at B unless it's already green.

## The phase signal — a file, never an env var

The runner reads `checks/test/.phase`: a single line holding one chain letter (`C`).
- **Present** (`= N`) → PHASE MODE: `rank(greenBy) <= rank(N)` is *due*, the rest *pending*.
- **Absent** → STRICT: every test is due.

`.phase` is **git-ignored and never committed** (Chain A adds it to `.gitignore`). The *dispatcher*
(main thread, /opsx:apply) writes it into **each chain's worktree** (`<worktree>/checks/test/.phase`)
before dispatching that chain. There is no delete step: an untracked file never reaches a commit, so
the final `gate-full.sh` on the merged main tip — and a fresh CI checkout — run STRICT by
construction. Rationale for a file over `CHECKS_PHASE=…`:
an env-prefixed command is not in `bash-policy.sh`'s auto-allow (anchored at command start) and would
stall a subagent; the plain `./scripts/gate.sh` the implementer runs IS auto-allowed. Fail-closed:
a missing `.phase` yields strict, never a silent skip.

## Semantics (per test)

| state | pass | fail |
|---|---|---|
| **due** (`greenBy ≤ phase`, or STRICT) | PASS | **FAIL** → suite exits non-zero |
| **pending** (`greenBy > phase`) | **XPASS** (tolerated, REPORTED) | PENDING (tolerated) |

- Suite exits non-zero **iff ≥1 due test failed**. PENDING/XPASS never fail the suite.
- **XPASS** = a not-yet-due test that already passes. Surfaced, never swallowed — it is the
  vacuity tripwire (a test green before its code exists is likely vacuous), same spirit as the
  invariants negative control. The chain that owns that `greenBy` verifies it is non-vacuous.
- Summary line (parsed by no one, read by humans): `PASS a · PENDING b · XPASS c · FAIL d`.
- `run.mjs` propagates the non-zero exit so `gate.sh`'s `check "static-checks"` gates on it.

## The schedule (greenBy → chain that retires it)

| greenBy | retired by chain | covers |
|---|---|---|
| `B` | B | `contract.ts` importable standalone; kind union closed; data tables well-formed; harness self-test |
| `C` | C | parse short-circuit; import allowlist (specifier/`require`/dynamic); forbidden-global walk (direct/alias/computed/`.constructor`/pollution/string-timers); shadowing NOT flagged |
| `D` | D | manifest extraction (literal-only, survives failure); capability both directions; screen-graph; SDK lint; schema validate+diff |
| `E` | E | `runStaticChecks` ordering + purity/determinism; honest fixtures zero-diagnostics; `latency-probe` expected-flagged |

## Invariants (the load-bearing ones)

- **Nothing pends forever.** STRICT (final/CI) makes every test due, so an unimplemented assertion
  FAILS the gate — a `greenBy` deadline that never arrives cannot hide.
- **`.phase` never reaches a commit or CI.** Git-ignored; the dispatcher's writes stay local to each
  chain's worktree (discarded at worktree teardown); the implementer's diff never contains it.
- **The harness is frozen after B.** C/D/E ADD tagged tests and turn code green; they never edit the
  `test()`/phase logic (a needed change is a class-B stop). It is ordinary `checks/` code — NOT
  hook-protected — so implementers author it freely; only the `gate.sh` wiring is human-bootstrap.
