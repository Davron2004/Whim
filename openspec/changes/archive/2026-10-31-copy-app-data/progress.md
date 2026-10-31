# Progress: copy-app-data

## chain-4 (device-probe): tasks 5.1-5.2

Branch `chain/copy-app-data-4`, BASE `a579f6f8` (integration/beta-2). The probe is chain-1's `RUN_DATA_COPY_PROBE`
(`App.tsx`, `DataCopyProbeScreen`); the flag was flipped only in the installed builds and stays `false` in the commit.
Each platform ran the probe twice: launch 1, then a SIGKILL of the app, then launch 2 (durability read-back).
Builds were proven fresh by grepping the bundle for the probe literal `data-copy-durable`.

### Runtimes

| | Android | iOS |
|---|---|---|
| Runtime | `Whim_Verify` AVD, API 36 (16k-page arm64 image), headless, swiftshader, port 5560 | iPhone 17 simulator, iOS 27.0, created for this run and deleted |
| Build | `:app:assembleOffline` (offline, debuggable, debug-signed), arm64 | Release, `-sdk iphonesimulator` |
| op-sqlite SQLite | 3.51.3 | 3.51.3 |
| `PRAGMA journal_mode` | `delete` (rollback journal, not WAL) | `delete` |

### D8: a second connection (answered: op-sqlite opens its own native connection)

A copy opened beside an engine that already held the store open and snapshotted it while the engine kept writing.
Both platforms: the copy resolved, `quick_check` `ok`, and the copy held a consistent row count within
`[rowsAtStart, sourceRowsAfter]` (copiedRows == sourceRowsAfter in every run). op-sqlite neither refused nor shared the handle,
so **D8's fallback (unbind the source realm first) is not needed for the copy to work**.

One consequence D8 did not state: **with `journal_mode=delete`, a write on the live engine's connection that lands while the
snapshot's read transaction is open fails with `[op-sqlite] statement execution error: database is locked`**, because the
engine's connection has no `busy_timeout` (the copy's own source connection sets 5000 ms, the engine's does not). It is a race:

| run | copy ms | writes during copy | failed writes |
|---|---|---|---|
| Android launch 1 | 46 | 1 | 1 |
| Android launch 2 | 250 | 1 | 5 |
| iOS launch 1 | 55 | 1 | 1 |
| iOS launch 2 | 9 | 2 | 0 |

The failed write is refused, not lost (the copy and the source stay consistent; the caller sees a thrown error). It matters only
when a bound realm of the source app writes during a copy. The probe asserts zero failed writes, so it reports FAIL (1)
whenever the race hits (3 of 4 runs). Filed as GitHub issue #165 and fixed (next section).

### Fix for #165: `busy_timeout` on every connection

Decision (product owner): every connection to a store sets `PRAGMA busy_timeout = BUSY_TIMEOUT_MS`, one named constant
(`src/host/storage-engine/busy-timeout.ts`, 5000 ms, at least D7's copy budget). It is set where each binding builds its
executor: `createNodeSqlExecutor` (node:sqlite) and `createOpSqlExecutorOver` (op-sqlite, which `createOpSqlExecutor` and the
copy's device opener both go through); `copy.ts` uses the same constant for its source connection. A write that meets the
snapshot's read lock now waits instead of throwing. Unbinding the source realm stays D8's fallback (design.md D8).

Node test: `§H copy: a live-engine write that meets the snapshot's lock waits for it and succeeds` (`test/copy.suite.ts`). A
second process holds a read transaction on the store for 400 ms (this thread cannot both hold the lock and be the blocked
writer); the engine write must not throw, must have waited, and must land. Red-check: with the pragma deleted, and with it set
to 0, the suite fails 3 checks, "live write during a snapshot: the write that met the lock did not throw (got Error: database
is locked)", "...the write waited for the lock instead of slipping past it (0 ms)" and "...the write is in the store".

Device re-run with the fix (flag on in the installed builds only; builds proven fresh by the bundle's changed pragma string):

| platform | runs | failed writes per run | writes during copy | probe |
|---|---|---|---|---|
| Android (emulator-5560) | 5 | 0, 0, 0, 0, 0 | 4, 2, 2, 2, 2 | PASS x5 |
| iOS (fresh iPhone 17 sim) | 5 | 0, 0, 0, 0, 0 | 2, 2, 2, 2, 2 | PASS x5 |

Before the fix: Android 1 and 5 failed writes (FAIL(1) both runs), iOS 1 and 0. Every run also read back the prior launch's
copy (500 of 500 rows, `quick_check` `ok`), and the 70 MB copy took 176-595 ms (Android) and 162-413 ms (iOS). The iOS
snapshot of the 2000-row store is so short (12-24 ms) that the race rarely hit even before the fix; Android is the platform that
discriminates.

### `getDbPath`

- Android: `/data/user/0/com.anycognition.whim/databases//storage/<appId>.db` (note the double slash).
- iOS: `<app container>/Library/storage/<appId>.db`.
- The copy file lands in the same directory as the source on both (`<appId>__copy.db` beside `<appId>.db`), so the device
  opener's `dir = dirname(getDbPath())` is correct on both platforms.

### D7: 50 MB time

The source the probe builds is 70,098,944 bytes (66.9 MiB; 51,200 rows of 1 KiB), above the 50 MiB target. The copy is the same
size, `quick_check` `ok`, in every run.

| run | copy ms | budget |
|---|---|---|
| Android launch 1 | 187 | 5000 |
| Android launch 2 (CPU loaded by other builds) | 574 | 5000 |
| iOS launch 1 | 536 | 5000 |
| iOS launch 2 | 175 | 5000 |

The budget (50 MB in 5 s) holds by a factor of 9 or more on both runtimes.

### D2 durability

After launch 1 wrote its copy (`writtenThisLaunch: true`), the app process was SIGKILLed (`run-as ... kill -9` on Android,
`kill -9` of the simulator process on iOS) and relaunched. Both platforms: `priorCopyFound: true`, `priorCopyRows: 500`
(expected 500), `priorCopyQuickCheck: "ok"`. **A kill of the process after `VACUUM INTO` returns does not lose the output, so
D2's explicit commit-transaction fallback is not needed.** This probes process death only: a power loss or an OS crash cannot be
induced on an emulator or simulator, so the `synchronous=FULL` guarantee itself is not independently verified here.

### Contradictions with D2/D7/D8

None to `copyStore`. The live-writer `database is locked` race was in the engine connection (no busy timeout) and is fixed above.

### Device state at the end

No emulator or simulator of this run is left running. The iOS simulator was deleted. On `Whim_Verify` the probe build replaced
the installed Whim (`install -r -d`, the installed versionCode was higher) and its `data-copy-*` store files were removed (again after the #165 re-run).

### Commands that worked (from a worktree made by `scripts/worktree.sh create`)

Flip the flag in the worktree first (`sed -i '' 's/^const RUN_DATA_COPY_PROBE = false;/const RUN_DATA_COPY_PROBE = true;/' App.tsx`), and `git checkout App.tsx` afterwards.

Android (never `npm run android:release`: `react-native run-android` installs on every attached device):

```sh
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" JAVA_HOME=$HOME/.sdkman/candidates/java/21.0.9-tem ANDROID_SERIAL=emulator-5560
cd <worktree>/android && ./gradlew :app:assembleOffline --console=plain     # 2m49s, loaded machine
$HOME/Library/Android/sdk/emulator/emulator @Whim_Verify -no-snapshot -no-boot-anim -no-window -gpu swiftshader_indirect -port 5560 &
adb -s emulator-5560 install -r -d <worktree>/android/app/build/outputs/apk/offline/app-offline.apk   # -d: the AVD's Whim has a higher versionCode
adb -s emulator-5560 shell am start -n com.anycognition.whim/com.whim.MainActivity   # applicationId and activity package differ; `monkey -p` did not launch
adb -s emulator-5560 exec-out screencap -p > shot.png        # poll `uiautomator dump` for text="PASS|FAIL" first
adb -s emulator-5560 shell run-as com.anycognition.whim kill -9 $(adb -s emulator-5560 shell pidof com.anycognition.whim)
adb -s emulator-5560 emu kill
```

iOS (the Gemfile's cocoapods is not installed here, `bundle exec pod install` fails; the global `pod` 1.17.0 works):

```sh
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" LANG=en_US.UTF-8
cd <worktree>/ios && pod install
U=$(xcrun simctl create whim-copyprobe-chain4 com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcodebuild -workspace Whim.xcworkspace -scheme Whim -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$U" -derivedDataPath build/sim build
git checkout Podfile.lock Whim.xcodeproj/project.pbxproj Whim/PrivacyInfo.xcprivacy       # pod install and the build modify these
xcrun simctl boot $U && xcrun simctl install $U build/sim/Build/Products/Release-iphonesimulator/Whim.app
PID=$(xcrun simctl launch $U com.anycognition.whim | awk '{print $2}'); xcrun simctl io $U screenshot shot.png
kill -9 $PID; xcrun simctl launch $U com.anycognition.whim                                   # durability read-back
xcrun simctl shutdown $U; xcrun simctl delete $U
```

## Merge (integration orchestrator, shift 2)

- chain-4 merged into `integration/beta-2` as `0ccd05d2`; integrity exit 0; gate-full PASS. Reviewer (not the
  author): findings, all low. The probe files open raw handles with no busy timeout (not product paths), and the
  new test's `waited >= HOLD_MS / 2` check can fail on a machine that schedules the parent more than 200 ms late.

## Shift 4 (integration orchestrator, 2026-10-30)

- chain-3 split (big chain: storage engine + UI + docs): **3a** = task 3.0 (`hasSavedData(appId)` in the storage engine + `StoreAccess`; files disjoint from design-system-v1's in-flight LOW batch), **3b** = tasks 3.1–3.4 + 4.1–4.2 (LauncherRoot/HomeScreen/HistoryScreen/copy.ts + docs) after the LOW batch merges and 3a merges. chain-5 (device e2e) after 3b.
- dispatched: 3a builder implementer SONNET high, BASE `482985d7`, worktree `.claude/worktrees/copy-app-data-3a`, branch `chain/copy-app-data-3a`; contract handoff/has-saved-data.md for 3b.
- 3a builder (Sonnet high, ~141k): complete `21b26b5f` + contract `78f6020b` (handoff/has-saved-data.md). true iff kv or any collection table has a row (`_meta` never counts); `StoreAccess.hasSavedData(entry)` asks `engineAppId(entry)`; missing/failed read → true (ask). Device: op-sqlite has no existence check → probe opens (creates), reads, deletes if no table, in one sync turn; Node checks existence first. storage 307/0, launcher 19823/0, typecheck 0, eslint 0; 6 red-checks. Flag: knip may flag the export until 3b wires it. dispatched: 3a runner (Sonnet medium, + knip probe) and 3a reviewer (Opus high).
- 3a reviewer (Opus high): ACCEPT with 2 MEDIUM / 3 LOW (saved handoff/review-3a.md). Wording question to the PO (default: tasks.md:67 → 'never leaves a file …', PO-accepted). 3a merges together with 3b (knip); 3b branches from 3a's tip and carries the LOWs + the RUN_STORAGE_PROBE steps.
- PO ruling 40 (3.0 wording): OK to 'never leaves a file …' + on-device probe step, WITH GUARD: the probe skips any appId whose store is open or opening in this process (in-process registry; preferred over timing reasoning) + a test: probe while that appId's store is mid-open → no delete. Recorded PO-accepted with this guard; 3b implements it and amends tasks.md:67.
- 3a runner (Sonnet medium): PASS: gate.sh exit 0, 0 ^FAIL; integrity 0 (11 files); ratchet PASS; red (entry.id instead of engineAppId) → 2 fail; knip exit 0, no output (the export is not flagged) → 3a merges alone; nothing calls hasSavedData until 3b (which adds the ruling-40 guard). Verdict `57a61d63`.
- merged: 3a `3ee12682` (--no-ff); worktree + branch removed.
- chain-3b split again (UI + storage in one chain is too big): **3b1** (Sonnet high) = ruling-40 guard (skip a store open/opening in-process; mid-open test), tasks.md:67 wording, RUN_STORAGE_PROBE device steps, 3a review LOWs; **3b2** (Opus high) = tasks 3.1–3.4 + the UI half of 3.0 (skip the question when hasSavedData is false) + 4.1–4.2. Disjoint files; dispatched in parallel, BASE `d54a0d54`, worktrees `.claude/worktrees/copy-app-data-3b1|3b2`.
- 3b1 builder (Sonnet high, ~95k): complete `0c0ecda2`. New open-stores.ts registry (hold before open, release on close/failed open; persistent executor, createStorageEngine, peekAppliedSchema, copy opener tracked); probeSavedData returns true for a held id without touching the file; tests (mid-open, engine-held, refcounts, failed open, other id); tasks.md 3.0 wording per ruling 40 (+ red-check clause aligned); device steps saved-data-device-acceptance.ts (verdict key savedData; file absence must be confirmed from outside the app by chain-5: adb run-as / simctl); LOWs. storage 319/0, launcher 19844/0, typecheck 0, eslint 0, openspec 1.4.1 strict / 1.14.1 0; red: guard removed → fail; hold after open → fail. dispatched: 3b1 runner (Sonnet medium) + reviewer (Opus high).
- 3b1 runner (Sonnet medium): PASS `a6ad16de` (gate 0, integrity 0, ratchet PASS, guard removed → mid-open test fails). 3b1 reviewer (Opus high): ACCEPT, MEDIUM: the copy target `to` isn't held during VACUUM INTO (copy-device.ts:52); LOWs (engine-constructor throw leaks a hold; copy opener hold untested; contract rule wording).
- **PO ruling 40 REVISED (owner's idea; supersedes the guard):** no create-then-delete at all. (1) Manifest first: an app that declares no storage in ANY version it has ever had → false without opening anything (contract.ts:273 "store handle present iff the app declares storage"; use the accumulated schema/manifest the version store keeps; no second source of truth, #41). (2) Declares storage → open its store and count user rows (kv or any collection); never infer from file existence; a transient create is harmless and NOT deleted (the engine opens this store before the bundle's first run anyway, D7). (3) Confirm with the code line that the engine's first open of a pre-existing 0-table file initialises _meta/kv normally; tests: declares storage but never ran → false, then run it → engine initialises and data written afterwards is found; no storage declared → false and no file created. (4) tasks.md:67 → "never creates a store for an app that declares no storage; for one that does, it reads row counts and never deletes" (owner-proposed, PO-accepted, 2026-10-30). Drop the delete code path and its race reasoning. If the version store can't give a cheap "ever declared storage" answer, TELL THE PO before building a workaround.
- 3b1 PARKED → `wip/copy-app-data-3b1` (superseded; reference only). Its worktree `.claude/worktrees/copy-app-data-3b1` can be removed by the next orchestrator.
- 3b2 builder (Opus high, ~199k): complete `a6742afb` + `3894cce0` (handoff/chain-3b2.md on the branch): tasks 3.0 UI half, 3.1–3.4, 4.1 (decision #84, incl. chain-4 probe numbers), 4.2. launcher 20000/0, checks 457/0, typecheck 0, eslint 0; 6 red-checks. Class-A deviations: new `COPY.copyQuestionHiddenData` line (the existing hidden-data line's own comment rules it out for a copy), shown as the sheet footer before answering; "Start fresh" after a failed data copy is the failure toast's 6 s action; chain-15 had already built CopyQuestionSheet; decision #84 records the chain-4 probe numbers. NOT yet reviewed or gated: next orchestrator dispatches 3b2 review (Opus high) + runner, after the 3b1 rework (ruling 40 revised) lands or in parallel (disjoint: storage-engine/store-access vs launcher UI; 3b2 calls `access.hasSavedData(entry)`, same signature).

## Shift 4b (integration orchestrator, 2026-10-30)

- old 3b1 worktree removed (branch `wip/copy-app-data-3b1` kept as reference).
- dispatched: **3b1r** (ruling 40 REVISED rework) builder implementer OPUS high (judgment: the "ever declared storage" source + the engine-first-open proof), BASE `20d7a0f9`, worktree `.claude/worktrees/copy-app-data-3b1r`, branch `chain/copy-app-data-3b1r`; stop-and-report if the version store has no cheap answer (PO asks first).
- dispatched in parallel: **3b2** reviewer (Opus high) + runner (Sonnet medium; allowlist `scratchpad/allow/3b2.txt`) on `chain/copy-app-data-3b2` @ `3894cce0` (BASE `d54a0d54`).
- 3b2 reviewer (Opus high, ~106k): ACCEPT with findings (saved handoff/review-3b2.md): MED fixtures `capabilities: []` + saved kv break under ruling 40 REVISED; MED #84 wording; MED spec delta lacks the skip rule; LOWs (History `hidesData` captured at tap, #84 probe range, system.md:785 footer, constant-only check). Both Class-A deviations accepted. → one 3b2 fix pass after its runner finishes.
- 3b1r builder (Opus high, ~162k): complete `a1b8ebc6` + handoff `f18d426b`. Step 0 YES: current record manifests answer with no I/O; only storage-free-looking apps walk the timeline newest-first (stop at first declaring version; per-repo memo shared with `declaredSchemas`; manifest-less legacy counts as declaring). Read = open/SELECT/close, never deletes; Node variant now creates a missing file like op-sqlite. Device steps wired (`savedData`), not run. tasks.md:67 reworded. Citation engine.ts:81-83/58-66. storage 304/0, launcher 19857/0, typecheck 0, eslint 0, openspec 1.4.1 strict 0 / 1.14.1 0; red: drop declaration check → 4 fail; limit 1 → 2 fail. Flags: 3b2 fixtures must declare storage (fixture-only fix in 3b2). dispatched: 3b1r reviewer (Opus high) + runner (Sonnet medium, allowlist `scratchpad/allow/3b1r.txt`).
- 3b2 runner (Sonnet medium): PASS `5132adfd` (gate 0, 0 ^FAIL; integrity 0, 15 files; ratchet PASS; red: onAskSavedData asks app.id → 2 legacy-copy tests fail). Void for merge after the fix pass (re-run needed).
- dispatched: 3b2 fixer (implementer SONNET high, precise findings 1–9; brief `scratchpad/brief-3b2-fix.md`).
- 3b1r reviewer (Opus high, ~100k): ACCEPT with findings (saved handoff/review-3b1r.md): MED group members untested; MED walk cost (getSnapshot reads every file per version, no bound/measurement); LOW known limit reachable (filed #244, kept false for beta-2); LOWs blank/empty split, device-acceptance cleanup, contract fixture line.
- 3b1r runner (Sonnet medium): PASS (partial: ratchet) `e6468980`: gate 0, integrity 0 (12 files), red (current-manifest-only variant) → 5 fail incl. (c); ratchet FAIL saved-data.suite.ts 29→26 assertions / 10→9 tests, no trailer. ORCHESTRATOR: removal ACCEPTED (ruling 40 REVISED drops the delete path; no-file guarantee tested in StoreAccess) → trailer in the fix pass.
- ORCHESTRATOR DEFAULT (recorded): device threshold for the declaration walk (chain-5): saved-data answer ≤1000 ms on the first Make-a-copy tap, ≤150 ms on the second, 25-version no-storage app on Whim_Verify.
- dispatched: 3b1r fixer (implementer OPUS high; MED 1–2, LOW 3–6, Check-removal trailer; stop if no single-file version read exists).
- 3b1r fixer (Opus high, ~92k): `fbfb4553` (Check-removal trailer; no attribution): MED 1 group-member test (red: members narrowed → 4 fail); LOW 4 StoreContents 'empty'|'data'; LOW 5 device steps finally + every check; LOW 3/6 contract lines; handoff 52 lines. storage 304/0, launcher 19862/0, typecheck 0, eslint 0, openspec 1.4.1 strict 0 / 1.14.1 0. MED 2 BLOCKED [B]: the version store has no single-file read (getSnapshot/getPinned/active read every file; diff reads both sides). → asked the PO (option 1: add a single-file version read and use it; option 2: accept cost for beta-2, chain-5 measures). 3b1r unmerged until the answer.
- 3b2 fixer (Sonnet high, ~111k): `7221230a`: findings 1–9 (fixtures declare storage; History footer read at question time after the saved-data read, red → 2 fail; spec SHALL line 1 + skip scenario; #84 revised; system.md footer clause; constant check dropped). launcher 20002/0, typecheck 0, eslint 0, openspec 1.4.1 strict valid / 1.14.1 4 pre-existing warnings. dispatched: 3b2 re-review (Opus medium, incl. cross-branch reasoning vs 3b1r) + runner re-run (Sonnet medium).
- PO ruling 41 (2026-10-30): option 1. NARROW product-verb version read (a version's manifest + schema artifact; no generic path read, no git vocabulary, #36/#39; StoreAccess the one path, #43b); switch the storage walk AND declaredSchemas; test the walk never reads bundle.js; vstore acceptance case red-checked; resolves #212 (close with the merge SHA). #244: false is fine for beta-2. dispatched: 3b1r piece 2 builder (implementer OPUS high, brief `scratchpad/brief-3b1r-41.md`).
- 3b2 re-review (Opus medium): REJECT: HIGH fork-ui.suite.tsx:84/:97 Timer (record only, no repo) → under 3b1r everDeclaredStorage throws on checkout → hasSavedData true → question shown, test fails after the merge (reasoned, not run); LOW spec delta names code (`StoreAccess.hasSavedData`) instead of behaviour. Everything else holds (cross-branch: tests expecting the question are fine under 3b1r). 3b2 runner re-run stopped (void; its gate PIDs killed). PLAN: merge 3b1r first, then a 3b2 fixer merges the staging tip into its branch and fixes against the combined code.
- 3b1r piece 2 builder (Opus high, ~127k): `789bc858` + handoff `acca7b7f`. Verb `declarationOf(appId, snapshotId) → { manifest: string|null, schema: string|null }` (top-level listing + two blobs; unknown → 'unknown snapshot'); walk + declaredSchemas use it via the shared memo; delta specs/mini-app-versioning (ADDED). vstore 118/0, storage 304/0, launcher 19870/0 (needs --mb 4096; 2048 CAPPED once), typecheck 0, eslint 0, openspec 1.4.1 strict 0 / 1.14.1 0. Red: walk on getSnapshot → 4 fail (bundle reads [2,2,2]); verb reads whole snapshot → vstore 2 fail. [A] version-record countSnapshotReads counts declarationOf; repo-less entry still answers true (documented). dispatched: 3b1r re-review (Opus medium) + runner re-run (Sonnet medium).
- 3b1r re-review (Opus medium): ACCEPT with findings (fix pass + piece 2; verb narrow, error surface = getSnapshot, tests discriminate, trailer covers only the storage-suite drop). LOWs: chain-3b1r.md 73 lines (>60); mini-app-versioning delta says 'never its prompt' but readTree reads the commit record (message = prompt): say 'no file other than manifest/schema'; fbfb4553 body says MED 2 blocked (fix at /git-cleanup). INFO rollback still reads whole snapshot → #245. LOW 1–2 go to the post-merge 3b2 fixer (docs only).
- 3b1r runner re-run (Sonnet medium): PASS `724fec9b`: gate 0, 0 ^FAIL; integrity 0; ratchet PASS (one authorised line: storage saved-data suite, fbfb4553 trailer); red (declarationOf also reads the whole snapshot) → vstore 3 fail. Re-review line above accepts the fix pass + piece 2.
- merged: 3b1r `cc3aee76` (--no-ff); worktree + branch removed. #212 closed with cc3aee76. Post-merge regate deferred to the 3b2 merge's regate (descendant; 3b2 merges next).
- dispatched: 3b2 fix pass 2 (implementer SONNET high): merge the staging tip into the 3b2 branch (stop on conflict), Timer fixture as a real no-storage version (HIGH), spec behaviour wording, 3b1r re-review LOWs 1–2; tests on the combined code.
- 3b2 fix pass 2 (Sonnet high, ~73k): merge `d8c575c3` (staging into 3b2, no conflict) + fix `fb3b46f2`: Timer = real no-storage version (red: manifest {} → question shows, test fails); waits for toast/question (async saved-data read); spec behaviour wording; mini-app-versioning wording (480 chars); chain-3b1r.md 60 lines. launcher --only 804/0, full 20028/0 (--mb 4096), storage 304/0, vstore 118/0, typecheck 0, eslint 0, openspec 1.4.1 strict 0 / 1.14.1 4 pre-existing warnings. dispatched: 3b2 re-review 2 (Opus medium) + runner (Sonnet medium, integrity/ratchet vs merge-base cc3aee76).
- 3b2 re-review 2 (Opus medium): ACCEPT (HIGH closed: Timer installed via StoreAccess.install with a real `{"capabilities":[]}` manifest; waits fail if the question shows; no late-fork leak; spec wordings OK). LOWs parked (cosmetic): chain-3b1r.md:26 still predicts the Timer case HOLDS; fork-ui.suite.tsx:105 toast assertion redundant after the waitFor.
- 3b2 runner (Sonnet medium): PASS `a331f48e`: gate 0, 0 ^FAIL; integrity 0 (vs merge-base cc3aee76); ratchet PASS (no authorised lines); red (Timer manifest {}) → Timer test fails; 0 attribution lines. Re-review 2 above accepts.
- merged: 3b2 `dc0e13b9` (--no-ff). Ticked 3.0–3.4, 4.1–4.2. Post-merge regate (covers 3b1r + 3b2) dispatched.
- gate-full on `124e5173` (orchestrator, background, capped 8192/3000): exit 0, FULL GATE PASSED, 0 ^FAIL, no CAPPED; tree clean. Covers the post-merge regates of 3b1r (cc3aee76) and 3b2 (dc0e13b9).
- dispatched: **chain-5** device e2e (ATTENDED chain run on emulator/simulator per the shift brief): c5a Android Whim_Verify 5560 (5.3, ruling-40-REVISED file checks, 5.5 legacy upgrade from a `main` build via worktree device-c5a-main, pixel checks) and c5i iOS sim clone (5.4, file checks, pixel checks), both Sonnet high, worktrees `.claude/worktrees/device-c5a|device-c5i` at `ad8fc314`; brief `scratchpad/brief-c5.md`.
- chain-5 c5a (Sonnet high, ~256k, ~61 min): verdict `1bb6f340` on device/c5a (handoff/5-c5a.md; APK artefacts-ad8fc314/android; local stub patch for a storage app, reverted, saved as stub-patch.diff). 5.3 PASS (partial: busy-state pixel check not observable — a 200 MB copy takes ~1 s; verify_failed/io toasts unreachable; question sheet compared by eye): copy/independence/delete/fresh/History footer checked on screen + via run-as + sqlite3; force-stop 0.5 s into a 200 MB copy → no tile, partial swept, retry complete (quick_check ok). Ruling 40 REVISED PASS (no-storage app: no question, no file; never-saved storage app: no question, 0-byte file, nothing deleted). 5.5 PASS (main @ 401099bf shared copy → tip over it: still shared; Copy the data → independent; delete keeps data). Findings filed: #255 orphan -journal sidecar (LOW), #256 toast over the exiting sheet (LOW), #257 stub [[storage]] marker. c5i (iOS 5.4) STILL RUNNING at the shift-4b stop (Release build capped at 40 min under load, rebuilding arm64-only); worktrees device-c5a, device-c5a-main, device-c5i left for the next orchestrator.
- gate-full on `3c6ac212` (orchestrator, background): exit 0, FULL GATE PASSED, 0 ^FAIL, no CAPPED (covers s4b-kb, s4b-docs, separate-shared-data chain-1).

## Shift 4c (integration orchestrator, 2026-10-31)

- chain-5 c5i (Sonnet high, collected after the shift-4b stop): verdict `8c87acad` (handoff/5-c5i.md; Whim.app artefacts-ad8fc314/ios, arm64-only rebuild after a 2400 s CAP at load 100–190). 5.4 PASS (partial: no busy cue during a ~2 s 136 MB copy; failure toasts not reached on iOS; pixel check by eye): copy/independence/delete/fresh/history footer checked from outside via simctl app container + sqlite3; terminate mid-copy → no tile, partial swept, retry complete. Ruling 40 REVISED PASS from outside. #256 (toast over sheet) did not reproduce on iOS. Findings: iOS repro of #255 (commented); no busy cue → filed #259 (Home's triggering control is a closed menu/sheet; spec SHALL "the triggering control shows busy"; LOW for beta-2).
- ticked 5.3 / 5.4 / 5.5 with PASS (partial: …) wording; verdict files 5-c5a.md, 5-c5i.md copied into handoff/. Worktrees device-c5a, device-c5a-main, device-c5i and branches device/c5a, device/c5i removed. copy-app-data: all tasks ticked.
