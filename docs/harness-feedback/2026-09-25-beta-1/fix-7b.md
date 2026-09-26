# fix-7b (last oldest-reader gaps), implementer, Opus

- **What:** Committing per item meant setting item 2's code aside with `git stash` so item 1's tree could be gated on its own. **Mechanism:** I wrote item 2's code before committing item 1. **Verdict:** DRAWBACK (my own ordering). **Cost:** 2 extra stash/restore rounds and 3 full gate runs instead of 1–2. **Evidence:** the commits `2a7a0672` / `aaf4c5fa` each passed a gate run with only their own changes in the tree.

Proposal: check in the launcher-test typecheck as a script (e.g. `scripts/typecheck-launcher-tests.sh <files>`) that builds the scratch tsconfig, runs it at the base commit and at HEAD, and prints only new errors. Each chain works this out again, and a clean result means nothing without the base run.
