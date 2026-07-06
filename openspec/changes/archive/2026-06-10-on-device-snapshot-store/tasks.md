## 1. Host-side store scaffold + Hermes load

- [x] 1.1 Add the host-side version-store module to the RN app (depends on the `webview-sandbox-runtime` RN shell existing); add `isomorphic-git` (v1.38.4) + `buffer`, `text-encoding-polyfill`, `pako`, `sha.js`, `crc-32`
- [x] 1.2 Install the Hermes polyfills **before** isomorphic-git: `global.Buffer`, `TextEncoder`/`TextDecoder` (Hermes ships the encoder but **not** the decoder), and the 3-line `process` shim
- [x] 1.3 Confirm `isomorphic-git` loads and `git.init` runs under Hermes on the Android target (offline release bundle)

## 2. Per-app repo + code-artifact contract (D2)

- [x] 2.1 Implement one repo per mini-app, keyed by a stable local app id
- [x] 2.2 Define the tracked code-artifact set — `bundle` source, `manifest.json`, `LEARNED.md`, `prompt.md` — and write/stage them into the repo on each generation
- [x] 2.3 Enforce the code/data boundary: the store API materializes code artifacts only and holds **no handle** to any user-data store (assert it never reads/writes data)

## 3. Product-verb API over the git subset (D3, git never surfaced)

- [x] 3.1 `snapshot(appId, artifacts, prompt)` → `commit` with the structured prompt as the message **and** a tracked `prompt.md`
- [x] 3.2 `history(appId, {limit})` → `log`, capped/paginated, returning each snapshot with its prompt (no hashes/git terms in the returned shape)
- [x] 3.3 `diff(appId, a, b)` → `walk` + compare (no `git.diff` exists), returning the per-file change between two snapshots
- [x] 3.4 `rollback(appId, snapshotId)` → `checkout`, non-destructive (later snapshots remain present and returnable)
- [x] 3.5 `pin(appId, snapshotId, label)` → `tag`, retrievable by label regardless of later generations
- [x] 3.6 `fork(appId, snapshotId)` → `branch` **then** `checkout` (two calls — `branch({checkout:true})` does not materialize the working tree); forked lineage advances independently, original unchanged
- [x] 3.7 Assert the API surface exposes **no** git terminology, commands, or commit identifiers (the "git never exposed" spec requirement)

## 4. Compaction — DIY pack-then-drop-loose (D5)

- [x] 4.1 Implement compaction: `packObjects` the reachable objects, then drop the now-redundant loose objects, preserving full history/rollback/fork reachability
- [x] 4.2 Trigger compaction on a tunable **loose-object-count** threshold (count is the cost driver, not byte size); expose the threshold as config
- [x] 4.3 Verify post-compaction integrity: history, rollback, pin, and fork all still resolve against the packed repo

## 5. Persistent backing + cross-restart acceptance (D4)

- [x] 5.1 Implement the MMKV/AsyncStorage serialize-to-KV FS backend behind the same fs interface the engine uses (zero native FS surface)
- [x] 5.2 Validate **cross-app-restart persistence**: snapshot, kill+relaunch the app, and confirm the repo + full history/pins/forks survive intact (the spike's handed-forward acceptance bar)
- [x] 5.3 Exercise repeated commit/checkout **plus restart** cycles and assert no repo corruption; if KV-backed FS proves unreliable, fall back to the characterized native FS backend

## 6. Forward seams (D6) — no new code, just don't preclude

- [x] 6.1 Confirm the store is **content-agnostic**: an extra tracked file (e.g. a future `schema`) is versioned/diffed/rolled-back like any other artifact, with no schema-specific handling
- [x] 6.2 Confirm rollback of a multi-file snapshot restores *all* tracked code files together (so a future `schema` file rolls back in lockstep with the bundle)

## 7. Node verification → on-device acceptance + spec check (D7)

- [x] 7.1 Unit-test the pure-JS core (verbs, no-merge, compaction) in Node over a normal/`memfs` FS as a fast checkpoint
- [x] 7.2 Run the on-device acceptance on the RN/Hermes Android target: full lifecycle (snapshot ×N, history, diff, rollback, pin, fork) + compaction + cross-restart, 0 failures
- [x] 7.3 Measure on-device storage growth (loose-object count/gen, packed size) and per-op latency; record numbers in `docs/decisions.md` / `DEVLOG.md`
- [x] 7.4 Confirm all `mini-app-versioning` + `mini-app-forking` spec scenarios pass (incl. immutable-snapshot-with-prompt, non-destructive rollback, pin survives later gens, independent forks, no-merge, git-never-exposed)
