# progress ledger: flow-wait-hygiene

- run-start 2026-08-21 — staging branch `integration/flow-wait-hygiene` cut from `v1-sprint` tip bb1c4dd (sprint precedent; main receives the sprint PR). Serial DAG: chain-1 → 2 → 3 → 4 → 5 (declared `after:` for shared LauncherRoot.tsx / copy.ts).
- dispatched 2026-08-21 — chain-1 transport-cancel-timeout, BASE bb1c4dd, worktree .claude/worktrees/flow-wait-hygiene-1
- report 2026-08-21 — chain-1 STATUS complete, GATE PASS, commit 9903cc6 (6715 launcher checks, 3 discriminating red-checks). Deviation (A→B-adjacent, ACCEPTED under D2 escape hatch): XHR connect window is a JS setTimeout + xhr.abort(), not `xhr.timeout` — RN captures `timeout` at send() (no post-send disarm) and Android maps it to OkHttp callTimeout bounding the streamed body, which would kill >15s generations (spec-forbidden). Class-A: touched transport-shared.ts (owner of ClientOptions) for the shared window constant/test seam; hoisted a test double for sonarjs/no-nested-functions.
- merged 2026-08-21 — chain-1 → integration (regate-pass); trailer stripped at merge per user rule. Worktree removed.
- dispatched 2026-08-21 — chain-2 launcher-compose-plan-cancel, BASE 6920e87, worktree .claude/worktrees/flow-wait-hygiene-2
- report 2026-08-21 — chain-2 STATUS complete, GATE PASS, commit 5ed09f8 (6742 launcher checks, 5 red-checks incl. the weaker-variant `kind !== 'home'`). Class-A: new pure sibling `flow-request.ts` (FlowRequests + onlyOnStep) for Node-testability; Settings gear is also a compose leave path; leave-handler clears `busy`. Accepted.
- merged 2026-08-21 — chain-2 → integration (regate-pass). Worktree removed.
- dispatched 2026-08-21 — chain-3 launcher-open-fork-delete-busy, BASE f2e860e, worktree .claude/worktrees/flow-wait-hygiene-3
- report 2026-08-21 — chain-3 STATUS complete, GATE PASS, commit 3c435fb (6830 launcher checks; red-check discriminated "row disabled but op still reaches version store"). Class-A: new `app-busy.ts` (AppBusy + runAppOp); handlers now return runAppOp(...); widened two brittle tile-colour regexes; COPY +actionForkBusy/actionDeleteBusy. Accepted.
- merged 2026-08-21 — chain-3 → integration (regate-pass). Worktree removed.
