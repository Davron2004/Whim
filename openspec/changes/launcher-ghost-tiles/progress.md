# Progress ledger — launcher-ghost-tiles

Append-only. Every disposition recorded as it happens.

## Run start

- **run-start** (2026-08-10): staging branch `integration/launcher-ghost-tiles`, BASE `a7bbc9e`.
- **BASE DEVIATION (owner-ratified):** the staging branch was cut from **`redesign`**, not `main`.
  `main` (795c8bd) is 30 commits behind `redesign` and is a strict ancestor of it; the entire
  obs-v1 change merged into `redesign` via PR #23, never into `main`. Every planning artifact for
  this change — notably `research.md`'s `file:line` pointers (`LauncherRoot.tsx:500-588`,
  `HomeScreen.tsx:60,98-120`) — resolves only against `redesign`; the `src/host/launcher/` diff
  between the two branches is 64 files, +8850/−1103, including files absent from `main` entirely
  (`xhr-transport.ts`, `transport-shared.ts`, `webview-error.ts`). Cutting from `main` would have
  handed implementers coordinates pointing at different code. Owner chose `redesign` as this run's
  base; the closure PR therefore targets `redesign`, not `main`.
- **Precondition clearing (owner-ratified, all three):**
  - Uncommitted trailing-slash fix in `server-address.ts` + 3 tests in
    `prompt-flow-wiring.suite.ts` committed standalone onto `redesign` as `a7bbc9e`
    (`fix(launcher): strip trailing slashes from the persisted server address`) — unrelated to this
    change, kept out of its diff.
  - Stale `integration/obs-v1` deleted local (`git branch -D`, unsandboxed to avoid stranding a
    dead `.git/config` section) and remote. Verified fully absorbed: the two-dot tree diff
    `redesign → integration/obs-v1` was pure deletions plus 0-line renames into
    `openspec/changes/archive/2026-08-10-obs-v1/`, i.e. `redesign` is strictly ahead. The 31-commit
    `redesign..obs-v1` count was an artifact of `/git-cleanup` rewriting SHAs before PR #23 merged.
  - Three unrelated untracked change folders (`flow-wait-hygiene`, `generation-observability`,
    `server-connectivity`) are the owner's parallel planning work; left untracked and out of this run.

## Chain DAG

Strictly serial — chain-1 → chain-2 → chain-3, each declaring `after:` its predecessor. No two
chains are dependency-free, so no wave runs in parallel this change.

| chain | tasks | writes-contract | after |
|-------|-------|-----------------|-------|
| chain-1 persistence-pending-store | 1.1–1.4 | `handoff/pending-store.md` | — |
| chain-2 flow-shell-wiring | 2.1–2.5 | `handoff/ghost-handlers.md` | chain-1 |
| chain-3 ui-grid-tiles | 3.1–3.5 | none | chain-2 |

No chain touches Class-2 config (gate scripts, `.claude/**`, `invariants/`, `build/`); none is
HUMAN-BOOTSTRAP.

## Dispositions

