# Launcher age and retry failures review

Independent read-only review of `99a8e6d24bfbbad4b639d14cd24b3243d9ac00fa` against pinned BASE `100d71f79c45f6d2e8509f85fa8e9bd492b73b50`.

## Findings

### HIGH — guardian-acknowledgment persistence can still reject the legal-flow effect

`src/host/launcher/age-check.ts:179` writes `whim.significant-update:v1` outside the new persistence guard. For an approved minor with outdated terms whose guardian acknowledges, a throwing KV write rejects `approvedMinorResult`, then `runAgeCheck`; `LauncherRoot.tsx:1106` observes that promise with `.then` only. The user remains on the checking screen and the effect can create an unhandled rejection. This directly contradicts the DONE contract that a failed guardian-acknowledgment write preserves the derived allowed result. `test/age-check.suite.ts:107-114` covers only the age-outcome key, not this acknowledgment key.

### HIGH — failure after the pending record is recreated can strand it as `building`

`LauncherRoot.tsx:1620-1635` catches `journal.create` after `startPendingBuild` has recreated the record. Its recovery calls `settleFailed`, which first writes a terminal journal entry at `LauncherRoot.tsx:1468`. `RunJournalStore.create` and `appendTerminal` both write the same journal key (`run-journal.ts:156-160, 233-264`). A key-selective or persistent journal write failure therefore throws again before `failPendingBuild`; the retry record remains `building`, no generic failure is rendered, and no request was sent. The new rendered case only replaces `PendingBuildStore.prototype.create` before it writes (`attempt-lifecycle-ui.suite.tsx:142-155`), so it cannot exercise this partial sibling boundary. The same catch cannot identify a `pending.create` failure after its record write but before its order write, because `attemptId` has not yet been assigned.

The changed files match the four-file allowlist and `git diff --check` is clean. The age-outcome catch itself preserves the three-second native/store and sixty-second guardian deadlines, writes only the fixed content-free warning, and the consent-resumed pre-write retry regression is meaningful. The two cases above leave the cohort short of its stated recovery contract.

No suites or gates were run by this reviewer.
