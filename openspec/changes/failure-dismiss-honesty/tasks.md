## 1. Honest exits on the failure screen

- [ ] 1.1 `copy.ts`: change `failureDismiss` to 'Discard this attempt'; add
      `failureBack: 'Back to your apps'`.
- [ ] 1.2 `FailureScreen.tsx`: add an `onBack` prop; render Back (`failureBack`) as the plain
      prominent exit and Discard (`failureDismiss`) as the secondary, visibly destructive action,
      token-styled per the screen's existing idiom; Retry unchanged.
- [ ] 1.3 `LauncherRoot.tsx`: wire `onBack` to the same navigate-home transition the dismiss path
      uses but WITHOUT `dropAttempt` — no record, journal, or store call on the leave path; keep
      `onDismiss` → `onDismissPending` → `dropAttempt` for Discard, both entry points (ghost-opened
      and live-failure).
- [ ] 1.4 Hardware back on the failure screen performs the non-destructive Back (rewire if it
      currently dismisses; assert either way).
- [ ] 1.5 Suites: update `failure-screen.suite.ts` copy/source locks; add behavioural coverage in
      `prompt-flow-wiring.suite.ts` that Back leaves the pending-build record AND its journal
      readable while Discard deletes both; confirm the `dropPendingBuild(` one-call-site lock
      still holds (the leave path must not add a second).

## 2. Validation

- [ ] 2.1 `npm run launcher:test` and `npm run lint` green; `./scripts/gate.sh` PASS.
