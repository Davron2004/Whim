# legal-surface-v2 chain-5 (implementer) — harness feedback

- **What:** The fast gate failed on the emoji scan in a file this chain never touched; same failure on BASE.
  - **Mechanism:** gate check (static-checks source scan) plus the Node version given in the chain block
  - **Verdict:** ENV
  - **Cost:** about 8 tool calls (stash round-trip to test BASE, both Node versions)
  - **Evidence:** `✗ FAIL source scan: … src/host/launcher/orb-actions.ts:39, …:42`. `/\p{Extended_Pictographic}/u.test('✎')` is true on v22.20.0 and false on v22.23.1.
- **What:** Lint rejected a catch that doesn't bind the error.
  - **Mechanism:** gate check (eslint no-restricted-syntax)
  - **Verdict:** NEUTRAL
  - **Cost:** 2 tool calls
  - **Evidence:** `src/host/launcher/error-details.ts:22:5 … No error is swallowed silently`
- **What:** A native Android build can't run in the worktree (no `node_modules`); checked the TurboModule change with a codegen run from the primary tree instead.
  - **Mechanism:** worktree setup
  - **Verdict:** DRAWBACK
  - **Cost:** about 4 tool calls
  - **Evidence:** `ls node_modules/react-native` → No such file or directory
- **What:** Needed a scratch helper to apply each weaker version, run the suite and restore, because files carried uncommitted changes.
  - **Mechanism:** runbook rule (red-check each new test)
  - **Verdict:** NEUTRAL
  - **Cost:** about 10 suite runs, ~12 minutes
  - **Evidence:** 8 red-checks in the report

**What helped:** the chain block named exact files, the contracts and the test seams (`rendered-launcher`, `LauncherSetup.terms`); the pure-module-beside-RN convention made every rule testable.

**What the harness should change:**
1. Pin one Node version for gates (chain block + gate.sh preflight printing `node -v`/Unicode version); better, make the emoji scan ICU-independent with an explicit code-point list.
2. A `fixloop.sh redcheck`-style helper that works against uncommitted edits.
3. Symlink `node_modules` into chain worktrees (or document a codegen-only check) so native spec changes can be checked.
