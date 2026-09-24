# developer-observability fix-1 (implementer) — harness feedback

- **What:** Lint cognitive-complexity 35 > 15 in a new test fixture, then a nested-ternary error; split into three functions. **Mechanism:** gate lint. **Verdict:** DRAWBACK (T9). **Cost:** ~4 min.
- **What:** The first gate log mixed two runs' output (`FAST GATE PASSED` mid-file, `FAILED: lint` at the end). **Mechanism:** shared scratchpad file name across parallel agents (fix-2 saw the same). **Verdict:** ENV/DRAWBACK (T7). **Cost:** ~3 min.
- **What:** No single-suite mode; 3391 server checks per iteration. **Verdict:** DRAWBACK (T10). **Cost:** ~6 min.
- **What:** Red-checked against the real BASE file by hand (swap, run, restore, `cmp`). **Verdict:** NEUTRAL (T6).
- **What:** Co-author reminder vs the user's rule. **Verdict:** NEUTRAL (T11).

**What helped:** the chain block settled the design (owner decision, exact compose command, where the project dir is, which red-checks); `runVmFixture`, `plant`/`checkCaught` and the YAML helpers allowed testing against the real Ops Agent glob.

**What the harness should change:**
1. `SUITE=deploy-config` single-suite filter for `server:test`.
2. `redcheck --from-ref <sha> <file>`: swap from a ref, run a named suite, restore with a hash check, record failing tests.
3. `gate.sh` prints a run id and writes its own log path.
