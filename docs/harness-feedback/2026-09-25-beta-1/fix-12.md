# fix-12 (sheet accessibility, History back spec + fallback, seed keyboard check), implementer, Opus

- **What:** you can't run one launcher suite on its own. **Mechanism:** `run.mjs` bundles all of `acceptance.ts`. **Verdict:** DRAWBACK. **Cost:** 4 full launcher runs (red, weaker variant, green, gate) plus 2 checks runs. **Evidence:** `launcher-red.txt` / `launcher-weaker.txt` / `launcher-green.txt`; last "13592 checks passed, 0 failed".
- **What:** failing launcher runs leave `.launcher-acceptance.<pid>.tmp.mjs` in the worktree. **Mechanism:** `process.exit` skips the runner's `finally`. **Verdict:** DRAWBACK. **Cost:** 1 call. **Evidence:** two leftover bundles.
- **What:** the scratch-tsconfig base comparison was clean once line numbers were stripped. **Mechanism:** a `diff` of the sorted, line-stripped tsc output. **Verdict:** NEUTRAL (helped). **Cost:** 2 calls. **Evidence:** diff exit 0; ~25 pre-existing errors at base.
- **What:** one commit per item, with one test file shared by items 1 and 3, needed a hand-built intermediate file. **Mechanism:** `git add -p` is interactive (unsupported). **Verdict:** DRAWBACK. **Cost:** 3 calls. **Evidence:** the item-1-only suite was built by script and byte-checked.

Proposal: a `LAUNCHER_SUITES=<name,...>` filter in `src/host/launcher/test/acceptance.ts` (never set by the gate) so a red-check runs one suite in seconds.
