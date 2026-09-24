# developer-observability git-cleaner — harness feedback

- **What:** 38 commits (28 first-parent) → 7 semantic commits; tip tree equals the pin on the first attempt. **Mechanism:** index-only rebuild + tree gate. **Verdict:** NEUTRAL (worked). **Cost:** ~20 calls, <1 min.

**What helped:** the dispatch gave exact boundary SHAs, ranges and drafted titles, so no judgment calls were needed.

**What the harness should change:** none; the template works for linear first-parent histories.
