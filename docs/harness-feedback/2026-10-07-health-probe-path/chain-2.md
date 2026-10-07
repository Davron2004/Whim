# chain-2 (app probe), implementer, Sonnet

- **What:** the first self-gate failed `server` with "@whim/contract is bundled into the entry" although the chain touched only `src/host/launcher/`; the worktree has no `node_modules`, so `@whim/*` resolved to the primary tree. The dispatch prompt did not mention the symlink step; a memory note did.
  **Mechanism:** tooling / dispatch prompt · **Verdict:** DRAWBACK · **Cost:** 1 extra full gate (~4 min) · **Evidence:** `XX  @whim/contract is bundled into the entry — ["contract/src/disclosure-manifest.ts"]`, gone after `ln -s ../../contract node_modules/@whim/contract` (and `server`)
- **What:** `gate.sh | tail` hides which check failed; only the final `FAST GATE FAILED: server` line survives, so the log had to be redirected to a file and rerun.
  **Mechanism:** tooling · **Verdict:** DRAWBACK · **Cost:** 1 extra gate run · **Evidence:** `FAST GATE FAILED: server` with every `PASS` line ahead of it
- **What:** the existing launcher fixtures that answer by path made the red-check cheap: renaming the probe path in them was mechanical, and weaker variants (fallback on any non-200, per-request deadline, fallback on network error, no fallback) each failed named assertions in the launcher suite.
  **Mechanism:** gate check · **Verdict:** CAUGHT-REAL-MISTAKE (of the planted kind) · **Cost:** ~10 min · **Evidence:** variant B (`AbortSignal.timeout` on the fallback) failed only `one signal covers both requests`
- **What:** BSD `sed -i` needs an empty suffix and has no `\b`; two edits failed before I switched to `sed -i ''` and perl.
  **Mechanism:** tooling · **Verdict:** NEUTRAL · **Cost:** 3 calls · **Evidence:** `sed: 1: "...": bad flag in substitute command: 'v'`

What helped: the chain block named every path-answering fixture with line numbers, so nothing needed searching.

What the harness should change: the dispatcher should create the `node_modules/@whim` symlinks in every chain worktree, not only for chains touching `contract/` or `server/`.
