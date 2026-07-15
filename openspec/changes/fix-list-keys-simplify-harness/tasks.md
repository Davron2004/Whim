## 1. Reconciliation-safe List rendering

- [x] 1.1 Restore unique wrapper keys for flattened `List` children without changing their order or divider styling.
- [x] 1.2 Add an independently discovered SDK acceptance test for repeated primitive `List` children and duplicate-key diagnostics.
- [x] 1.3 Run the SDK acceptance suite and fast gate from the implementation worktree.

## 2. Suite-local assertion clarity

- [x] 2.1 Replace the added result-forwarding layer in the server and bridge assertion helpers with direct accounting.
- [x] 2.2 Replace the added result-forwarding layer in the storage and launcher assertion helpers with direct accounting.
- [x] 2.3 Preserve each suite's existing pass counters, failures, console diagnostics, and runner failure behavior; run affected suites and the fast gate.

## 3. Integration verification

- [ ] 3.1 Run the canonical full gate on the merged tip, including the required OpenSpec validation.
- [x] 3.2 Review the completed change against the SDK design-system delta and record the result in the progress ledger.
