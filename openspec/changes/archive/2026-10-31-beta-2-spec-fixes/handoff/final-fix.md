# Final fix (whole-change review, runbook step 11): BASE e9f080b1

1. MEDIUM Not now: `LauncherRoot.tsx` Failure page `onNotNow={goHome}` -> `closeSheet` (running app: `keepDraft` + `setScreen(running)`;
   no running app: `goHome`, unchanged). New test in `whim-sheet-ui.suite.tsx`: change under a running app ends on an `update`
   fallback -> toast expires -> sheet -> See why -> needs-update page -> Not now -> not Home, not the Failure page, same MiniAppView launch.
   Red-check (once): reverted to `goHome` -> the suite failed on "Not now leaves the page and does not go Home" and "the same app is still
   running on screen"; restored. (Ran the whim-sheet suite alone through a temporary entry, deleted before commit: 72 checks green, then red.)
2. MEDIUM spec delta scenarios now `npm run android:release -- --device …` (2 lines; confirmed with `git diff`).
3. MEDIUM `specs/native-release-config/spec.md` gains `## ADDED Requirements`: dev loop script (one named device, exit 2, no packager
   window, real app id; 2 scenarios) and the release check refusing bypassing scripts (1 scenario). Two requirements, not one:
   openspec 1.14.1 warns on requirement text over 500 chars and `--strict` fails on warnings.
4. `docs/release/mobile.md`: real command with `--appId <WHIM_APP_ID>`; fallback `ANDROID_SERIAL=<serial> ./gradlew installOffline`.
5. `docs/design/mockups/index.html`: "When no progress event arrives for 40 s".
6. `holdDraftOf` comment: why `heldPromptRef` (keepDraft sets state, cannot run in a `setScreen` updater) and when the text returns
   (`takeHeldPrompt` on the next compose for the same app). No behaviour change.
7. `tasks.md` 7.1: clause naming `scripts/release/lib/android-dev-script.ts`; checkbox still `[x]`.

## Evidence
- `openspec validate beta-2-spec-fixes --strict`: valid (repo 1.4.1) and valid (`@fission-ai/openspec@1.14.1`).
- `npm run launcher:test`: exit 0, 19704 checks passed, 0 failed (one test added, none removed).
- `npm run -s typecheck`: exit 0. `npx eslint --max-warnings 0` on the two touched TS files: exit 0.
- checks:test not run: no release check or script was touched.
