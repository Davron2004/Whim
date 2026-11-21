# chain-7a: storage seed + exact readback tooling for 7.1/7.4 (pre-bump tree, op-sqlite 16.2.0)

## Design and why
- **Seed app = a stub-server fixture, not device code.** `[[fixture:storage-v1]]` / `[[fixture:storage-v2]]`
  in a prompt make the stub pipeline (`WHIM_PIPELINE=stub` only; production refuses to boot the stub)
  deliver the "Storage Fixture" app instead of the day checklist. The device installs it through the
  normal make/change path: a real app record, its own storage-engine appId, a second version via
  "Change it". No device code changed, so the SAME seed works on the iOS seed build (`main` 193e5f83)
  and the Android pre-bump build. Precedent: copy-app-data's c5a/c5i local `[[storage]]` stub patch;
  this makes it durable for later op-sqlite/RN upgrades and W7.
- Record assembled like the real pipeline: name/manifest/schema from the checker's one extraction
  (`runStaticChecks`), bundle from the production builder (`buildCandidateSource`), `assembleRecord`.
- **Data** (source generated from data in `server/src/stub-storage-fixture.ts`): v1 = Entries (c1:
  text/int/float/bool/date/json + `legacy` f7) and Tags (c2); 7+3 rows with edge values (empty string,
  unicode/emoji/newline/quotes, ±(2^53-1), 1.797e308, -1e-300, 0.30000000000000004, 1e21, ±8.64e15 dates,
  negative dates, json string/0/[]/nested, all-null row, title-only row) + 5 KV keys. v2 renames
  `count`→`quantity` (same f2), adds `note` f8 with default, **tombstones f7** (burned: `_meta` keeps it
  in `retired`, its data stays on disk), writes 1 row + 1 update. Each version writes once (KV flag),
  then reads EVERYTHING back and shows `Read back <fnv1a>: <n> rows, <m> keys` plus every row:
  the in-app second witness that the new build's read path returns what the old one wrote.
- **Readback** = `node scripts/release/run.mjs storage-dump | storage-diff | storage-seed-check`
  (`scripts/release/lib/storage-dump.ts`): every table (incl. `_meta`, `kv`), every row sorted by
  content, `sqlite_master` DDL, `integrity_check`, `user_version`, sidecar files. Exact cells: storage
  class + integer as `CAST(.. AS TEXT)` (no 2^53 rounding), real as shortest round-trip, blob as hex.
  Dumps a scratch copy (with its -journal/-wal/-shm, so recovery runs on the copy; evidence never
  written). `storage-diff` names each changed/missing/added row, table, DDL object, db, sidecar.
  `storage-seed-check` passes when some db has every type of the engine's `FIELD_TYPES`, a retired
  column holding data, two collections with rows.
- No spec delta: stub markers are unspecified dev tooling; release-upgrade-check behaviour unchanged.

## Files
server/src/stub-storage-fixture.ts (new), server/src/stub-markers.ts, server/src/pipeline.ts,
scripts/release/lib/storage-dump.ts (new), scripts/release/cli.ts (3 commands),
scripts/release/upgrade-check/seed-storage.yaml + read-storage.yaml (new Maestro flows),
server/test/stub-storage-fixture.suite.ts (new) + acceptance.ts, checks/test/release/storage-dump.suite.ts
(new) + index.ts, checks/test/release/upgrade-check.suite.ts (flow-selector test knows the fixture's
status lines).

## Device runbook (E = openspec/changes/upgrade-to-latest-dependencies/upgrade-data)
Server, both platforms: from a tree that HAS this chain (integration tip), port 8787:
`WHIM_PIPELINE=stub WHIM_DATA_DIR="$(mktemp -d)" node --env-file=<repo>/.env server/dev.mjs`.
contract/, server routes, stub, storage engine, bridge and SDK are identical between `main` 193e5f83
and BASE (`git diff --stat 193e5f83 3ee0f468` over them is empty), so the iOS main build talks to it.
In-app address: Settings > Advanced > Use your own server > `http://127.0.0.1:8787`.

**Android, Whim_Verify (emulator-5560), pre-bump offline APK (op-sqlite 16.2.0, debuggable for run-as)**
1. Fresh install (seed phase only): `adb -s emulator-5560 uninstall com.anycognition.whim`, `adb -s emulator-5560 install <pre.apk>`, `adb -s emulator-5560 reverse tcp:8787 tcp:8787`.
2. `maestro --device emulator-5560 test -e SERVER_URL=http://127.0.0.1:8787 scripts/release/upgrade-check/seed.yaml`
   (server address, consent, Water Counter data, Hello App x2), then
   `maestro --device emulator-5560 test scripts/release/upgrade-check/seed-storage.yaml`.
   By hand: Make an app > `A storage seed [[fixture:storage-v1]]` > Continue > Make it > Back to your
   apps > open Storage Fixture, wait for "Wrote the v1 seed." > relaunch > long-press > Change it >
   `Version two [[fixture:storage-v2]]` > Make the change > open it, wait for "Wrote the v2 seed.".
   ORDER MATTERS: v1 must be opened before v2 exists, or nothing is burned.
3. `maestro ... test scripts/release/upgrade-check/read-storage.yaml`, then `maestro --device emulator-5560 hierarchy > $E/android/before-screen.json` and a screenshot: record the `Read back ...: 11 rows, 7 keys` line.
4. `adb -s emulator-5560 shell am force-stop com.anycognition.whim`. Listing (keep it):
   `adb -s emulator-5560 exec-out run-as com.anycognition.whim find . -name '*.db*'` > `$E/android/before-files.txt`.
   Stores live at `/data/user/0/com.anycognition.whim/databases//storage/<appId>.db` (op-sqlite 16.2.0:
   `getDatabasePath()` base + `/storage`; run-as relative: `databases/storage/`). Pull each file
   (and any `-journal`/`-wal`/`-shm`): `adb -s emulator-5560 exec-out run-as com.anycognition.whim cat databases/storage/<f> > $E/android/before/<f>`.
5. `node scripts/release/run.mjs storage-dump $E/android/before --out $E/android/before.json`;
   `node scripts/release/run.mjs storage-seed-check $E/android/before.json` must PASS naming the fixture db.
6. 7.4: `adb -s emulator-5560 install -r <19.x.apk>` (NO uninstall). Run read-storage.yaml: the status
   MUST be "The v2 seed was already there." and the Read back line identical to step 3. "Wrote the v2
   seed." + `1 rows` = the 19.x build opened an empty db elsewhere (path change); "Storage failed: ..." = error.
7. Force-stop, redo the `find` listing into `$E/android/after-files.txt`, then
   `node scripts/release/run.mjs storage-files-diff $E/android/before-files.txt $E/android/after-files.txt`
   must PASS (a new `.db` anywhere = path move, which a diff of the old files alone would miss).
   Pull into `$E/android/after/`, dump to after.json,
   `node scripts/release/run.mjs storage-diff $E/android/before.json $E/android/after.json` must PASS.
   Then the RUN_STORAGE_PROBE run.

**iOS simulator: seed build `main` 193e5f83 .app (RN 0.85 + op-sqlite 16.2.0); keep the SAME simulator**
1. `xcrun simctl install <udid> <main Whim.app>`; seed as Android step 2 with `--device <udid>`
   (add `-e SCREEN_HEIGHT=<points>` to seed.yaml; seed-storage.yaml needs it only on 382511's tile menu).
2. read-storage.yaml + screenshot/hierarchy as step 3. `xcrun simctl terminate <udid> com.anycognition.whim`.
3. `C=$(xcrun simctl get_app_container <udid> com.anycognition.whim data)`; stores at
   `$C/Library/storage/<appId>.db` (op-sqlite: NSLibraryDirectory + `/storage`). `(cd "$C" && find . -name '*.db*')`
   > before-files.txt (relative, so a changed container path does not matter); `cp "$C"/Library/storage/* $E/ios/before/`; dump + seed-check as step 5.
4. `xcrun simctl install <udid> <19.x Whim.app>` over it (no uninstall); re-read `$C` (the container
   path can change), then steps 6-7 with `$E/ios/...` (after-files.txt from the same `cd "$C" && find .`). Both platforms should show the same digest.

## Tests and red-checks
- server:test `--only stub-storage-fixture`: 25 checks (delivery through stub rewrite+generate, record
  schema == source's, check stage clean for v1 and for v2 against v1's applied schema, v1 declares every
  `FIELD_TYPES` type; bundles executed in node:vm over a real engine on a db file: v1 alone FAILS the
  seed check, v1+v2 PASSES, `_meta` retired == v2 tombstones, re-open writes nothing and dumps identical).
- checks:test release `storage-dump.suite`: 14 tests (deterministic dump, file untouched; changed value,
  1-ulp real, int64 past 2^53, missing row, dropped table, changed `_meta`, db missing/added, sidecar,
  non-SQLite file; seed-check per missing `FIELD_TYPES` type, unburned, burned column emptied, one
  collection; CLI exit codes 0/1/2).
- RED seen (each mutation shown by `git diff --stat`, then reverted): row diff disabled → 6 FAIL;
  missing-object lines dropped → dropped-table FAIL; integers read as JS numbers → 2^53 FAIL; retired
  requirement removed → seed-check FAIL in both suites; `_meta` skipped by the dumper → `_meta` test +
  4 more FAIL; fixture v2 omitting instead of tombstoning f7 → check-stage drift + seed-check + retired FAIL.

## HARNESS FEEDBACK
- CAUGHT-REAL-MISTAKE: the red-check of "v2 omits f7" showed my `_meta retired == tombstones` check
  passed vacuously ([] == []); tightened to require a non-empty match.
- DRAWBACK: checks:test `--only` cannot select a release sub-suite; each red-check reran all 286 release tests.
- NEUTRAL: zsh in the Bash tool breaks unquoted `--include=*.ts` globs; quote them.

## Review round 1 fixes
- read-storage.yaml waits only for `The v2 seed was already there\.` and asserts the "Wrote the v2 seed." and
  "Storage failed: .*" states not visible. New upgrade-check.suite test checks the wait and the refusals
  against the fixture's real status strings; red: the old alternation wait -> that test FAILs.
- storage-dump.ts: `DatabaseDump.pragmas` (journal_mode, page_size, encoding, auto_vacuum), each diffed by name
  (`app-1.db: journal_mode "delete" -> "wal"`). Test: WAL / page_size 8192 / auto_vacuum FULL over identical rows
  each give exactly one diff line. Red: pragma diff loop removed -> that test FAILs. A dump made BEFORE this fix
  lacks the field: re-dump both sides with this tree's tooling (the db files are the evidence, not the dumps).
- seed check: every `FIELD_TYPES` entry needs a column holding a NON-NULL cell (`no column of type X holding a value`).
  Test: json column set all-NULL -> exactly that gap. Red: old declared-column check -> FAIL.
- pipeline.ts: a rejected fixture build is evicted from the cache (`void record.catch(delete)`). No test: the
  build only fails on a builder/checker fault, which no public interface can induce without adding a
  seam to production code; the change is one line next to the cache.
- New `storage-files-diff <before-listing> <after-listing>` (paths only: the runbook records paths, a leading `./`
  is ignored, an empty before listing fails); runbook steps 4/7 and the iOS steps use it (iOS listing is
  taken relative from `$C`). Tests: lib (moved/added/lost/empty) + CLI exit codes 0/1/2. Red: diff returns [] -> both FAIL.

## HARNESS FEEDBACK (fixer)
- CAUGHT-REAL-MISTAKE: review found the read flow green on its own failure states; a selector-vs-app-strings test cannot see that, so the new test asserts which strings the flow's wait accepts.
- NEUTRAL: pragma-diff test needed `VACUUM` to change page_size/auto_vacuum; plain PRAGMA is a no-op on an existing file.
