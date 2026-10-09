# Red-check evidence (2026-10-09)

## A: detector against the pinned pre-fix commit

Tree: `git archive 754e2f77cf470d2d8d858daf4c9c1d11ac291e4a` extracted to a scratch dir; `auditRepo(<that dir>)`
from `checks/test/repo/binding-provenance.ts`, bundled with `--external:typescript`. Exit 1:

```
{"guarded":[{"file":"synthrun/capability.ts","line":145},{"file":"synthrun/observe.ts","line":492}],
 "violations":[{"file":"invariants/sandbox-isolation/bridge/runner.mjs","line":72,"rule":"expose-function"}]}
```

Live tree (post-guard): exit 0, zero violations, guarded sites `invariants/sandbox-isolation/bridge/runner.mjs:118`,
`synthrun/capability.ts:145`, `synthrun/observe.ts:500`.

Weakened variants, each applied locally, run, and reverted:

- runner.mjs guard moved after `const frame = JSON.parse(raw);` → `npm run checks:test`:
  `FAIL ... invariants/sandbox-isolation/bridge/runner.mjs:118 guard-not-first` (308/1).
- detector weakened to accept the guard anywhere in the body (`statements.some(...)`) →
  `FAIL ... fixture/late-guard.ts: expected guard-not-first@2, got []` (308/1).
- Restored: `PASS 309 · FAIL 0`. The correctly guarded page- and context-level controls pass throughout.

## B: hostile caller in the sandboxed frame (`npm run bridge:invariants`, scenario 10)

- Guard as shipped: `PASS host-dispatch provenance ...: subordinate=true shim-installed=true name-reachable=true
  sysret=null engine-write-absent=true refusals=1 (want 1) positive-control=true` (14 checks held).
- Guard neutered to `if (false)`: `FAIL ... sysret="{\"whim\":\"sysret\",\"v\":1,\"id\":9201,\"ok\":true,\"result\":{}}"
  engine-write-absent=false refusals=0 (want 1) positive-control=true`.
- Guard moved after `await host.dispatch(raw)` (counter and `null` intact): `FAIL ... sysret=null
  engine-write-absent=false refusals=1` — only the engine read-back catches this variant.
- Restored: PASS, 14 checks held.
