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
whenever the race hits (3 of 4 runs). Filed as GitHub issue #165 for chain-2/3 to decide between
unbinding the source realm before `fork({ data: 'copy' })` and a `busy_timeout` on the engine's persistent connection.

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

None to the shipped copy engine. The only new fact is the live-writer `database is locked` race above, which concerns the
caller (when a source realm can write) rather than `copyStore`.

### Device state at the end

No emulator or simulator of this run is left running. The iOS simulator was deleted. On `Whim_Verify` the probe build replaced
the installed Whim (`install -r -d`, the installed versionCode was higher) and its `data-copy-*` store files were removed.

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
