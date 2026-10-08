# progress: durable-server-stores

Staging branch: `integration/beta-1` (shared beta-1 staging branch, reused — see docs/handoff-2026-10-07.md). main tip at run start: `06ab2007a3ac4f3f04febf8f6ca35b3ff192848f`.

DAG: chain-0 (HUMAN-BOOTSTRAP) → chain-1 → chain-2 → chain-3 → {chain-4 ∥ chain-5}. Tasks 7.x run attended after merge.

## Ledger

- 2026-10-07 run-start — staging integration/beta-1, MAIN_TIP 06ab2007a3ac4f3f04febf8f6ca35b3ff192848f
- 2026-10-07 chain-0 — applied by orchestrator (attended, owner ran both `npm install`s: `.claude/settings.json` denies `npm install:*` for every mode). Commits 1c77a840 (bootstrap) + 7f5e8acf (tick). gate-full PASS incl. new `firestore-stores`. Deviations: project id `demo-whim-conformance` (tasks.md said `whim-conformance`; `demo-` keeps the emulator offline); `firebase-tools` pinned as a root devDependency (knip flagged `firebase` as an unlisted binary otherwise); stub entry does an emulator round-trip so knip sees `@google-cloud/firestore` used. Audit delta (dev-only) filed as #142.
- 2026-10-07 chain-1 dispatched — BASE 7f5e8acf695323676ac75c4f29af898e32e3f91c, worktree .claude/worktrees/durable-server-stores-1, branch chain/durable-server-stores-1
- 2026-10-08 chain-1 report — STATUS complete, GATE PASS (server 4428/0), commit 5bcf26bf. Deviations, all class A: dev runners `server/{admin,waitlist}.mjs` externalize server runtime deps (pino could not bundle into ESM; admin.mjs was already broken at BASE); the CLIs open all three stores via `openStores`; `admit` contract restated in spec terms (orchestrator ruling); boot-level `WHIM_STORE_BACKEND=postgres` test in prod-build; conformance also covers `listUnresolvedCostRows`/`summary`/concurrent `credit`. Red-checks: a backend skipping the device limit fails limits/race/reused-id/refund cases; removing `AND ended_at IS NULL` fails exactly the settle case. Open for reviewer: `app.ts` still defaults reports/waitlist to in-memory when omitted. Gap routed to chain-2: boot does not log the store backend (needed by 7.1).
- 2026-10-08 chain-1 integrity — exit 0 (scope server/*, change folder). merged; regate PASS (FAST GATE PASSED). Worktree + branch removed.
