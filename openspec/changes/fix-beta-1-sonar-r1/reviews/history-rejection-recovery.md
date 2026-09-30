# History rejection recovery review

Independent read-only review: **CLEAN** for eeec0f08d432f03c259af162a5ff7ae2ac184775 against pinned BASE b6575a7b5c3b6f110ba18c3d7ebe57d6dc069a9d.

The two changed files exactly match the allowlist. No harness, configuration, contract, or check changes; the diff has no whitespace errors.

HistoryScreen retains runHistoryLoad's rejection contract and consumes it only at the component boundary. A list failure clears its loading state while retaining a successful prior list; the restore reload still produces its success toast after a completed restore. Restore-diff and annotation effects clear their pending/stale displays only while current, preserving their existing cancellation fences. The diagnostic field is the fixed operation name only; no error, prompt, version content, or stored data is logged.

The rendered regressions use real StoreAccess reads made to reject. They cover initial and reload list failures, pending reassurance clearing, annotation clearing, and a collapse-before-rejection race. Existing restore/copy tests retain the successful paths and double-submit invariant. These cases would leave rejected background effects or stale UI with the BASE source.

No suites or gates were run by this reviewer. The worker/root receipts and a later full gate remain the validation authority.
