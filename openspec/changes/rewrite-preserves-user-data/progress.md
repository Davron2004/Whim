# Ledger: rewrite-preserves-user-data

- run-start(2): staging=integration/rewrite-preserves-user-data BASE_TIP=v1-sprint(dd4352c) — first cut from main was WRONG (main is 354 commits behind; user directed v1-sprint lineage as baseline). Artifacts commit 92d2490.
- chain-1 attempt-1 (BASE=main-lineage) discarded: built against stale checks/; its commit 06ef96b kept unreferenced as reference.
- DAG: chain-1 -> {chain-2, chain-5}; chain-2 -> chain-3 -> chain-4 -> chain-6.
- chain-1: dispatched(BASE=92d2490) report=complete gate=PASS integrity=0 merged regate=PASS commit=4ea851f
- chain-2: dispatched(BASE=48c5e8e) report=complete gate=PASS integrity=0 merged commit=35fc65f redchecks=6-variant
- chain-5: dispatched(BASE=48c5e8e) report=complete gate=PASS integrity=0 merged commit=8f63fa8
- chain-3: dispatched(BASE=82dd783) report=complete gate=PASS integrity=0 merged commit=d2ed02b note=machine.suite header comment stale (chain-5 file) -> integration note
- chain-4: dispatched(BASE=a181fd1) report=complete gate=PASS integrity=0 merged commit=a7776f8 note=record.name-vs-entry.name choice logged
- chain-6: dispatched(BASE=5d3af66) report=complete gate=PASS integrity=0 merged commit=2e2d78d
- chain-6 merge redone from primary tree (first attempt ran inside the worktree, no-op); regate PASS
