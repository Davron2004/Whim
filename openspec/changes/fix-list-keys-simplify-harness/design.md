## Context

The Sonar cleanup changed `List` wrapper identity and added result-forwarding layers to
four intentionally small, suite-owned Node-test harnesses. The research digest
([research.md](research.md)) establishes that the wrapper list must remain correct for
repeated primitive `ReactNode` children and that the harnesses have different output
contracts despite their similar shape.

## Goals / Non-Goals

**Goals:**

- Restore unique wrapper identity for every `List` child and prove repeated primitive
  children do not cause React duplicate-key diagnostics.
- Return the four harness assertion entry points to direct accounting while preserving
  their existing counters, failures, output, and runner exit behavior.

**Non-Goals:**

- Do not add a shared assertion framework, alter any SDK API, or change rendering,
  ordering, divider styling, or containment behavior.
- Do not resolve the remaining protected Sonar findings in this change.

## Decisions

- Use the established positional wrapper key for `List`. It is unique for the flattened
  wrapper sibling set, handles repeated primitive content, and restores the pre-regression
  behavior. Child-derived keys were rejected because equal primitive values collide.
- Add a self-contained SDK acceptance test, discovered by the existing runner, that
  renders repeated primitive list items and treats a duplicate-key diagnostic as failure.
  This tests the observed regression without changing runner infrastructure.
- Inline each local harness's success/failure branch instead of introducing a shared helper.
  The four suites deliberately differ in their accounting/output contract, so a common
  abstraction would add coupling without removing meaningful duplication.

## Risks / Trade-offs

- [Positional wrapper identity does not preserve unkeyed-child identity through reorder]
  → This exactly restores `origin/main` behavior and does not affect the SDK public API.
- [Acceptance renderer differs from a browser runtime] → The same React reconciliation
  path is covered in the SDK runner, and the fast/full gate remains required.
