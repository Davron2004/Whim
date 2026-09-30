# Chain-10 R8 independent review

Range reviewed: `874be3307cabf29906be17137401723237a8ee3a..b8d16bbf60f9d0a2da760312163ff2c7e35f8f6f`.

VERDICT: report-mismatch

REPORT HONESTY: discrepancies: `/tmp/whim-beta1-chain10-coverage-r2.md` ends with `VERDICT: coverage complete`, but its matrix omits a required retained-discard/retry case and the implementation violates D19's current-list no-duplicates rule. The four task claims therefore cannot be accepted as complete.

FINDINGS:

- `src/host/launcher/pending-builds.ts:135`, `src/host/launcher/pending-builds.ts:183` — high — a Retry after a partial Discard can make `listCurrent()` return the same ID twice. If removal of `pending:<id>` succeeds but the `pending:order` write fails, the existing covered path leaves the raw order `[id]` and retains a volatile failed view. Retrying that ghost calls `create()` with the same ID; `existed` is false because it consults only the now-missing raw record, so `create()` writes `[id, ...readOrder()]`, producing `[id, id]`. `listCurrent()` records `seen` only after pushing and never skips an already-seen ID, so it returns two current views for one attempt. This violates D19 and the handoff requirement that the current list substitutes by ID and never duplicates; it can feed duplicate pending entries to Home.

SPEC CONFORMANCE: gaps: D19 requires `listCurrent()` to substitute by ID, preserve order, and avoid duplicates, including retained entries after a partial Discard. The composed source does not satisfy that requirement for the recovered Retry trigger above.

CHECK-WEAKENING SCAN: no Class-1 configuration, dependency, gate, generated-output, or `invariants/` changes appear in the reviewed range.

Scope and validation:

- The range changes exactly the seven allowed product/test files plus the 113-line handoff; `git diff --check` is clean.
- The R8 ownership implementation is otherwise materially exercised: the independent-stream case checks that A journals while selected B keeps its UI; the delivery tests pause at the real `StoreAccess.install` boundary and check both independent completion and same-ID pending deletion. The R7 RED receipt records failures against the old producer, and the supplied R7 green, lint, Knip, and pinned-gate receipts are credible for those cases.
- The partial-Discard test covers a later recovered Discard, not a Retry before that recovery, so it cannot catch this failure.
- No tests, builds, native jobs, or Git mutations were run for this review. No native restart pass is claimed.
