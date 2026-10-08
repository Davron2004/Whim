# Dispositions

- 2026-10-08 run-start — NESTED run from durable-server-stores closure; run-branch integration/beta-1 at 9e32f0db. Preconditions: worktree.baseRef=head; gate scripts committed clean.
- stale checks — L1 exit 0 (evidence re-derived from HEAD lines; Sonar analysed c5b60b0f), L2 exit 0, L3 exit 0. Planner step skipped for these three: each is a single-rule mechanical lane whose evidence is the cited lines themselves.
- L1, L2, L3 dispatched in parallel (fix-worker, isolation worktree) — BASE 438aab25.
- durable-server-stores follow-up review (fix-A/fix-B): verdict SHIP. Low findings folded into new lane L4 (dispatch after L1 merges — both edit deploy.sh): F1 purge-job failure alert; F2 #73 rollback wording (purge job keeps running); F3 skip purge-job update on `--tag` rollback; F4 retention overshoot wording (UTC day + hour for ledger/idle usage); F5 report id ≤1500 bytes; F7 usage-store header mentions `admissionId`; F8 comparator comments (UTF-16 vs UTF-8 order); F9 build.mjs run-directly guard; F10 evals/cli.mjs externals → shared source. F6 (credit double-count on lost reply, lifetime totals only) → issue.
