# Progress ledger: store-launch-compliance

Staging branch: integration/store-launch (shared launch run; MAIN_TIP 3a66cca)

- 17:53 dispatched chain-1 BASE 51f95bc (merge waits for the server-connectivity gate-full run in the primary tree)
- 18:05 chain-1 report: complete, GATE PASS, class-A x3 (grantConsent now is an ISO string value; 1.2/1.5 cases in prompt-flow-wiring suite; domain scan keyed on WHIM_DOMAIN to avoid KV-key false positives, red-checked) · integrity OK · merged · regate-pass
- 18:05 dispatched chain-2 BASE 9b537eb
- 18:28 chain-2 report: complete, GATE PASS, class-A x5 (contract-mirror.ts until server chain-1 lands; fake-xhr headers; optional headers read; 3-line LauncherRoot bridge cast replaced by chain-3; logging example renamed) · integrity OK · merged · regate-pass. RECONCILE when public-generation-server chain-1 merges: delete contract-mirror.ts, repoint imports to @whim/contract.
- 18:28 dispatched chain-3 BASE cba972c
- 19:00 chain-3 report: complete, GATE PASS (launcher 9030), class-A x4 (returnTo attached in LauncherRoot; ConsentScreenForShell for cognitive complexity; retired unconfigured-server copy and updated 4 source-pinned suites; server section label kept inside Advanced) · integrity OK · merged · regate-pass. Watch: brittle source-text assertions recur in later chains.
- 19:00 dispatched chain-4 BASE 78eba26
- 22:55 RESUME (fresh orchestrator after the usage cutoff): chain-4 worktree held ~250 lines of uncommitted work (ServiceNotice, refusal-landing, step wiring; pinned-assertion updates half done) → re-dispatched into the same worktree (BASE 78eba26) to continue from the diff.
- 23:18 chain-4 report: complete, GATE PASS, class-A x2 (complexity-driven extractions rewriteRefusalTarget/handleGenerateRefusal/refusedGenerateOutcome; contract authored fresh). Inherited draft verified correct for 4.1-4.5 and kept; added the missing suites (refusal-landing, D10 split, notice carry/clear); 3 source pins re-pinned, none loosened · integrity OK · merged · regate-pass
