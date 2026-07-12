# English test spec: checker surface + diagnostics catalog (tasks 1.1, 1.2)

Written before any pass implementation (§16.5). Encoded 1:1 in `checks/test/acceptance.ts`
on the greenBy harness (`handoff/greenby-harness.md`); each bullet below names the tagged
test(s) that assert it. All scenarios drive the public `runStaticChecks(source, opts)` black
box (design D8) — no test depends on a pass-internal function.

## 1.1 — the checker surface

**Parse short-circuit** (§C1) — a syntax error produces exactly one `parse_error` diagnostic
(at the offending source line) and nothing else; no later pass runs on a broken tree.

**Import allowlist, each rejection** (§C2):
- an off-allowlist static specifier (`lodash`, `react`, `react/jsx-runtime`, a relative path,
  a `vc-sdk` subpath) → `disallowed_import`, `symbol` = the specifier, hint names `vc-sdk`.
- `require(...)` → `disallowed_import`, hint names `vc-sdk`.
- dynamic `import(...)` → `disallowed_import`, even when the specifier is on-allowlist.

**Each forbidden-global class** (§C3, one test per class, plus the false-positive class):
direct reference to a forbidden name; bare reference to a global root itself; member access
through a local alias (taint follows lexical assignment); computed access on a tainted alias
with a statically-unknown key (the token-scan-miss case: no forbidden token literally appears
in the source); `.constructor` access (prototype-walk codegen); `Object.prototype` pollution
(`Object.defineProperty` on a shared prototype); string-argument `setTimeout` (implicit eval).
Each produces its diagnostic kind (`forbidden_global`, `prototype_pollution`, or
`implicit_eval`) with a non-empty hint. **Shadowing non-flagging**: a local parameter named
like a forbidden global, used only as a plain value in its own scope, produces NO
forbidden-global diagnostic.

**Manifest extraction** (§D1): a `capabilities` field that is an identifier (`someArray`) or
built from a non-literal expression (`['sto' + 'rage']`) → `manifest_not_static`, hint
requires a literal array. Extraction **survives other failures**: a source with a valid
literal `defineApp` argument plus an unrelated forbidden-global violation elsewhere still
yields `ok: false` AND a populated `report.manifest`.

**Both capability directions** (§D2): a capability-backed export used without its capability
declared → `undeclared_capability` error, `symbol` names the capability, hint shows the fix;
a capability declared but never exercised → `unused_capability` warning, `symbol` names the
capability.

**Screen-graph resolutions** (§D3): `initial` naming no `screens` key → `unresolved_screen`,
hint lists the declared screens. A recognized nav-call shape (test-injected into the shipped-
empty `NAV_CALL_SHAPES` table, proving the mechanism) whose string-literal target names no
screen → `unresolved_screen`, `symbol` = the dangling target, hint lists declared screens.

**SDK lint steering** (§D4): a raw `setTimeout(fn, …)` (function-arg form) → `raw_timer`
warning, hint names `delay`/`interval`.

**Schema validate + conflict mapping** (§D5): a schema literal whose burned field ID collides
with the supplied applied schema at a different type → `type_change` error whose `hint` is
IDENTICAL to `diffSchemas`'s own hint for the same conflict (verified by calling the real
engine function as ground truth in the test, not by copying a string). No applied schema
supplied → the diff baseline is `emptyApplied()`, so a well-formed first-generation schema
produces zero schema diagnostics. A malformed field type surfaces `validateArtifact`'s
`bad_field_type` kind verbatim.

**Report purity / determinism** (§E1): the same source checked twice (in any order) produces
deeply-equal reports. A source with an unconditional top-level side effect (a sentinel write,
a `throw`) never has that effect observed by the checking process — the source is analyzed,
never executed. Independent passes accumulate in one report; only the parse gate
short-circuits later passes.

**Zero-diagnostics honest fixtures** (§E2): `tip-splitter`, `water-counter`,
`pour-over-timer`, and `style-gallery` (four of the five real `fixtures/*.app.tsx` sources)
are each `ok: true` with zero diagnostics — the false-positive regression gate. `latency-probe`
is excluded from that set and pinned instead as expected-flagged: it must be `ok: false`,
carrying a `forbidden_global` (raw `globalThis.__whimSyscall` reach) and an `unused_capability`
(the `diag` capability has no SDK facade to exercise it through).

## 1.2 — the diagnostics catalog

**Hint mandatory** — every diagnostic in every report (across all scenarios above) carries a
non-empty `hint` string and a 1-based `line`; asserted both per-scenario and via a shared
`assertAllWellFormed` helper.

**Kinds closed + runtime-vocabulary match** — `DIAGNOSTIC_KINDS` (`checks/contract.ts`) is
exactly the 18-member set: 8 newly-authored static-pass kinds plus the 10 verbatim-reused
runtime/engine kinds. Every diagnostic's `kind` is a member of this set (never an ad-hoc
string). The static `undeclared_capability` kind string is asserted identical to the bridge
gate's own denial kind (`src/host/bridge`'s vocabulary) — one language for one mistake.

**Warning fails `ok`** — a report containing exactly one `warning` diagnostic and zero errors
still has `ok: false`. There is no severity-threshold knob in the public API.

**No suppression pragma** — a violating line decorated with any disable-style comment still
produces its diagnostic, unchanged. Diagnostic definitions are global to the catalog; there is
no per-app, per-user, or inline opt-out.
