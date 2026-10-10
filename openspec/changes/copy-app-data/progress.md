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
