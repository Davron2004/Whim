# Ledger: rewrite-preserves-user-data

- run-start: staging=integration/rewrite-preserves-user-data MAIN_TIP=795c8bdaa21fd5aa214e100ae1e8f8a11952efe8 (2026-08-23)
- artifacts committed to staging at run start (research/proposal/design/specs/tasks/chains)
- DAG: chain-1 → {chain-2, chain-5}; chain-2 → chain-3 → chain-4 → chain-6. chain-5 parallel with 2/3/4.
