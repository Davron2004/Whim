# developer-observability fix-3b (implementer) — harness feedback

- **What:** The chain block offered "the terminal event has a `code`, or the server sends a closed failure code"; neither exists on the wire, so device-side codes had to be designed. **Mechanism:** chain block. **Verdict:** DRAWBACK (T1). **Cost:** ~5 min.
- **What:** A type error in a brand-new test (TS2367) passed the gate; found only with a temporary tsconfig. **Mechanism:** test dirs not typechecked (T3, #79). **Verdict:** DRAWBACK. **Cost:** 3 calls.
- **What:** The first suite run caught a bug in the new 429 test (dedup key merged the "after window" record with the refused one). **Mechanism:** self-gate. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 1 rerun.
- **What:** Lint's no-silent-catch rule flagged `catch { threw = true; }` in a test. **Verdict:** CAUGHT-REAL-MISTAKE (minor). **Cost:** 1 gate rerun.
- **What:** ~9 full launcher-suite runs (no single-suite mode). **Verdict:** DRAWBACK (T10).
- **What:** Hand-rolled red-checks. **Verdict:** NEUTRAL (T6). **What:** `&&`/co-author instruction conflicts. **Verdict:** NEUTRAL (T2, T11). **What:** zsh `nomatch`. **Verdict:** ENV.

**What helped:** a precise decisions line in progress.md; file:line per item in the chain block; `withLauncher`/`streamingServer`/`startBuild`; server `plan.ts` bundling into the launcher suite so the fixture came from the real producer.

**What the harness should change:**
1. Typecheck test directories in `gate.sh` (#79).
2. `WHIM_SUITE=<name>` filter for the `run.mjs` runners.
3. Grep-verify interface claims a chain block offers as options.
