# Proposal: failure-dismiss-honesty

## Why

The failure screen's only exit deletes the failed/interrupted attempt while being labeled
"Back to your apps" — a destructive action wearing navigation copy. A user tapping the obvious
way out silently loses the record (and its run journal). Found live on-device 2026-08-21.

## What Changes

- The failure screen offers TWO exits with honest copy:
  - **"Back to your apps"** — a true no-op leave: returns to the launcher, the record and its
    ghost tile (and journal) remain untouched.
  - **"Discard this attempt"** — the existing destructive dismiss (record + journal deleted),
    relabeled so the copy says what it does, styled as the secondary/destructive action.
- Retry is unchanged.
- Spec delta: MODIFIED requirement "Failure screens hydrate from the persisted failure payload"
  in `prompt-flow` (adds the non-destructive leave; renames Dismiss's presentation contract).

## Impact

- Affected specs: prompt-flow (one MODIFIED requirement).
- Affected code: `src/host/launcher/copy.ts`, `FailureScreen.tsx`, `LauncherRoot.tsx`, and the
  two launcher suites that lock them. No store/journal API changes — the leave path simply does
  not call `dropAttempt`.
- Non-goals: no change to Retry semantics, to live-failure settlement, to ghost-tile rendering,
  or to the record/journal deletion machinery itself.
