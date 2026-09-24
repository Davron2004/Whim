# legal-surface-v2 git-cleaner — harness feedback

- **What:** Rebuilt 69 commits (50 first-parent) into 14 linear semantic commits on `3e417a55`; tip tree equals the pin. **Mechanism:** index-only rebuild + tree-identity gate. **Verdict:** NEUTRAL (worked). **Cost:** ~25 calls, one pass.
- **What:** The grouping guidance asked to fold fix-A/fix-B pieces into seven earlier thematic commits, impossible under an index-only snapshot rebuild because each fix chain is one atomic commit. Kept each as its own reviewer-round commit. **Mechanism:** dispatch guidance vs rebuild mechanics. **Verdict:** DRAWBACK. **Cost:** ~10 min analysis. **Evidence:** `git log 97810b49..1ee66a27` = 1 commit.

**What helped:** surveying `git show --stat` per merge before planning; reset --soft + read-tree/commit is conflict-free by construction.

**What the harness should change:**
1. The dispatch should state that a fix chain can only be folded into several groups if it was committed per concern; otherwise it keeps its own commit.
2. List each first-parent commit's `--stat` (or point at chains.md) in the dispatch to skip the survey.
