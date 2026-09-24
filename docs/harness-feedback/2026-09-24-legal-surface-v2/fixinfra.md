# legal-surface-v2 fix-infra (implementer) — harness feedback

- **What:** Lint failed on two copied `sonarjs/no-hardcoded-ip` disables that weren't needed. **Mechanism:** eslint `no-unused-disable`. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 1 gate run (~4 min).
- **What:** The task said mtime is enough for rotated files, which would have left mixed-age rotated files past the cap. **Mechanism:** chain block. **Verdict:** DRAWBACK (T1). **Cost:** ~5 min.
- **What:** Docker daemon down: couldn't capture real json-file lines or run under Debian `mawk`/GNU/systemd. **Mechanism:** tooling. **Verdict:** ENV. **Cost:** leaves the production path unverified until installed.
- **What:** `&&` rule contradiction. **Verdict:** DRAWBACK (one moment of doubt).
- **What:** Existing suite scans limit names (`RETENTION_DAYS`, accepted `WHIM_*`); read them first. **Mechanism:** gate checks. **Verdict:** NEUTRAL.

**What helped:** the suite's `plant()`/`checkCaught` pattern and `runVmFixture`; the chain block naming exactly which hunks fix-A touches.

**What the harness should change:**
1. For infra chains, state the invariant ("no line older than 90 days survives"), not the mechanism.
2. A Debian container runner (mawk + GNU coreutils) for `deploy/vm/*.sh` behaviour tests in `gate-full.sh`.
3. Make the command-chaining rule and the dispatch template agree.
