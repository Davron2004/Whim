# chain-7b report: op-sqlite 16.2.0 → 19.0.5 (7.2 minus pod install, 7.3, F4)

## Version + lockfile
`@op-engineering/op-sqlite` `^16.2.0` → `^19.0.5` (npm `latest`). Lockfile changes: the root dependency line and the
one package entry (version/resolved/integrity). Nothing added or removed. Peers are unchanged (`react *`,
`react-native *`, optional `@sqlite.org/sqlite-wasm`). `npm ls` = 19.0.5, no peer warnings. The package is not
in `dependency-pins.json` or the pin register.

## Breaking-change survey (GitHub releases 16.2.1…19.0.4 + source diff of installed 16.2.0 vs 19.0.5)
- Unused by Whim: 17.0 `executeRaw*` shape; 17.1/17.2 `readOnly`/`failOnCreate` (default off: open flags as 16,
  `cpp/OPBridge.cpp:146-154`); 18.0 crsqlite removed, Storage-class rename. 18.1.3 native files renamed `OP*`.
- 18.1.2 HostObject → NativeState: native closures capture the C++ object (`HFN(this)`). Extracted methods still work.
- 18.2.0 Android skips `kotlin-android` under AGP 9 built-in Kotlin. Whim has `android.builtInKotlin=false`, so it
  still applies the plugin.
- 19.0 errors carry `code`/`extendedCode`. The message is `[op-sqlite] <ctx>: <sqlite3_errmsg> (code N, extended
  code M)`, so the texts `copy.ts` matches are still in it (`copy.ts` reads `errcode`, never `code`: still
  correct; its comment "op-sqlite exposes only the message" is now stale). Native BEGIN/COMMIT moved into
  `executeBatch`, and `commit` is now sync: Whim uses neither. 19.0.1: one worker per connection; `close()`
  joins it.
- `executeSync` JS wrapper removed (`executeSync: db.executeSync`). 16's wrapper only rebuilt `rows` when they were
  missing. Native `create_js_rows` always sets `rows` (`cpp/OPUtils.cpp:180-214`), and `insertId` is set only when
  rowsAffected>0 && id≠0, as in 16. **The result shape the binding sees is unchanged.**
- `opsqlite_execute` (`cpp/OPBridge.cpp:407-542`) clears column names per statement and reads changes/insertId at
  each DONE. Single-statement results are identical.
- SQLite 3.51.3 → 3.53.4 (compatible format), no pragma on open. Metro still resolves `lib/module/index.js`. The new
  `react-native.config.js` only acts on `op-sqlite.tokenizers`; Whim has no `op-sqlite` config key.

## DB location: unchanged, so no data-loss risk
- Android base `getDatabasePath("defaultDatabase")` minus the name: 19 `OPSQLiteBridge.kt:27` == 16 `:22`.
- iOS base `NSLibraryDirectory` (no `OPSQLite_AppGroup` in Whim): 19 `ios/OPSQLite.mm:108-112` == 16 `:68-72`.
- location join: 19 `cpp/OPSqlite.cpp:88-96` == 16 `:73-80`. File path `opsqlite_get_db_path`: 19
  `cpp/OPBridge.cpp:114-129` == 16 `cpp/bridge.cpp:64-79`. `getDbPath`/`delete` use the same path.
- So `{name:'<appId>.db', location:'storage'}` → Android `databases/storage/<appId>.db`, iOS `Library/storage/…`, as in 16.

## Binding changes
Nothing was needed for the bump. The binding and its callers use only `open`/`executeSync`/`execute`/`getDbPath`/
`delete`/`close`, whose behavior is unchanged. The only change is F4. Class A: corrected the `android/build.gradle`
comment that gave op-sqlite as the library with no ndkVersion. The force stays (it covers any such library).

## F4: the ephemeral store was a file on disk (fixed)
- Cause: `open({name: ':memory:'})` with no location uses the storage base (`cpp/OPSqlite.cpp:65`).
  `opsqlite_get_db_path` short-circuits only for location `:memory:` (`cpp/OPBridge.cpp:117-119`), so SQLite got
  `<base>/:memory:`, a real file: Android `databases/:memory:` (24576 B seen), iOS `Library/:memory:`. 16.2.0 does
  the same (`cpp/OPSqlite.cpp:73-80`, `cpp/bridge.cpp:67-69`).
- True in-memory in 19.x: `location: ':memory:'`. This sets `path=":memory:"` (`cpp/OPSqlite.cpp:89-90`),
  `get_db_path` returns it before any `create_directories` (`cpp/OPBridge.cpp:117-119`), and
  `sqlite3_open_v2(":memory:")` (`:156`) gives a private database per open. The name is ignored (`src/types.ts`
  `OpenOptions.location`). There is no separate flag or API.
- Fix: the ephemeral branch is now `open({ name: '<appId>.db', location: ':memory:' })`. Users: only `device-acceptance.ts:212` (flag-gated `RUN_STORAGE_PROBE`, appId `ephemeral-probe`). Every product
  caller passes `persistent`. Node/synthrun/bridge use node:sqlite `:memory:`.
- Leak today: yes, across probe runs and across ephemeral instances of any appId: they all shared one file that
  survives restarts. The probe's `isolated` check compares against `storage/ephemeral-probe.db`, a different
  file, so it passed. No user data was ever involved.
- Stale file on upgraded devices: **not deleted**. It holds probe data only, and nothing opens it after the fix.
  Deleting it would put a disk touch, and a destructive operation, back on the path that is now disk-free.
  op-sqlite's only delete, `open(name).delete()`, creates the file when it is absent. Pre-release, only dev/test
  devices have it.
- Test: `launcher/test/ephemeral-storage.suite.ts` runs `createStorageEngine` over the op-sqlite double, whose
  `open` now resolves `location` as 19 does (the source lines are cited in its doc comment). It checks: no
  `:memory:`/`<appId>.db` file after a write-and-close; later ephemeral stores (same or other app) and the
  persistent store do not see the write. Red-check: with the old open restored, 3 checks fail (the `:memory:` file
  exists; both later stores read 'from the first session'). Restored: green.
- Device runner: on a FRESH install, run `RUN_STORAGE_PROBE`. Then `run-as com.anycognition.whim ls -la databases/`
  must show no `:memory:` (iOS: none in `Library/`). On the upgraded emulator, the stale `databases/:memory:` keeps
  its mtime and 24576 B after the probe.

## Watch in the native steps
- Android: the op-sqlite CMakeCache must show `ndk/27.1.12297006` and `libop-sqlite.so` must read `r522817b` (19
  sets `ndkVersion` from `rootProject.ext`, and the root force also applies). Expect `kotlin-android` applied and
  `OP*.cpp` sources. `install` still uses `catalystInstance.jsCallInvokerHolder`, as 16 did on 0.88.1. 7.4
  readback is the proof.
- iOS `pod install` (chain-5): the pod compiles as C++23, adds watchOS 9.0, and declares public headers
  `ios/OPSQLite.h`, `cpp/sqlite3.h`, `cpp/OPBridge.hpp` only. No new pod dependency. Runtime via
  `RCTBridgeProxy -runtime`, invoker via `_bridge.jsCallInvoker`. Still no privacy manifest: keep DiskSpace E174.1.

## HARNESS FEEDBACK
- CAUGHT-REAL-MISTAKE: the 16↔19 source diff (not the release notes) showed the dropped `executeSync` wrapper is
  safe only because native `create_js_rows` always sets `rows`. F4: the device seed caught what every Node double hid.
- NEUTRAL: 19.0.5 has no GitHub release; the source diff covers it. ENV: no native build was allowed on the shared machine, so every native claim is static. One gate run died with
  exit 144, cause unknown.

## Review round 1 fixes
- native-storage.ts double: `delete()` on an in-memory handle is a no-op; its `close()` no longer counts under `<appId>.db` in `closedDatabases`.
- ephemeral-storage.suite.ts: new tests for the full kv + records lifecycle (append/list/update/remove) on an ephemeral store with a persistent store of the same app empty afterwards, and for in-memory close/delete leaving the persistent database and its leak count alone.
- Red-check: reverting only native-storage.ts fails both double assertions (delete removed the db; close counted 1); restored.
- copy.ts comment corrected (op-sqlite 19 errors carry code/extendedCode; classification still reads the message, unchanged).

## HARNESS FEEDBACK (fixer)
- DRAWBACK: a double written from source drifted from real op-sqlite; the fix tests pin the double's own contract.
