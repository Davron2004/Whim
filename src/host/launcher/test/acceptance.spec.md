# On-device acceptance script (task 1.3 — the Done-when walk, design D8)

The authoritative containment + product verdict is the real Android System WebView on-device
(offline release APK; `npm run android:release`; read `ReactNativeJS` in logcat; the on-screen
diagnostics render is the source of truth for full JSON — logcat truncates ~4 KB). Desktop
gates (build, invariants, lint, the Node suites) are the fast pre-check; this walk is the pass.

Run on a fresh install (clear app data first, so the seed marker is virgin).

## The walk

1. **Fresh install → seeded grid.** Launch the host. The home grid shows **Tip Splitter** and
   **Water Counter**, both badged as examples, plus a prominent **"make your first app"**
   create tile. No probe bar is the default surface anymore. *(spec: a fresh install is not
   empty.)*

2. **Launch water-counter from its record (by source, not baked name).** Tap Water Counter.
   It launches full-screen in a fresh realm. The bundle was delivered via `bundleSource`
   (read from the version store's active snapshot), NOT via the baked `BUNDLES` name map.
   Confirm in logcat: the deliver path logs a by-source delivery; containment verdict is
   `CONTAINED ✓` for this realm.

3. **Syscalls live, data persists.** Tap "+1 glass" several times. The count increments; the
   syscall counter advances (storage kv.set + records.append round-trips). Force-stop the host,
   relaunch, re-open Water Counter: the count and history survive (the storage engine keyed by
   the launcher id).

4. **System back exits.** With Water Counter running (it reports no nav depth), press Android
   system back **once** → the host returns to the home grid immediately (depth-0 exit). The
   floating affordance, tapped instead, also exits.

5. **Fork → the fork runs with its own data.** Long-press Water Counter → **Fork**. A new
   entry appears carrying its provenance ("forked from Water Counter"). Open the fork: it runs
   the same bundle as the original at fork time, but its glass count starts at 0 and is
   independent — increment it, then open the original; the original's count is unchanged, and
   vice versa. *(Load-bearing: the fork's engine appId is its new launcher id; version-store
   access uses the original's `storeId` + the fork's lineage.)*

6. **Delete original, fork survives.** Long-press Water Counter (the original) → **Delete** →
   confirm. It disappears from the grid; the fork still launches, keeps its history, and keeps
   its own user data (the repo is still referenced by the fork — only the index entry was
   removed). *(spec: deleting the original spares a surviving fork.)*

7. **Delete fork → no residue.** Long-press the fork → **Delete** → confirm. Now no entry
   references the repo: the store's `remove` drops every repo key, the fork's user-data
   database is gone, and the index is empty for these apps. Force-stop + relaunch: deleted
   examples do not reappear (seed marker honored), and no trace of the deleted apps remains.
   *(spec: delete removes record, data, and history; deleted examples stay deleted.)*

8. **Containment 42/42 throughout.** The dev probe surface (reachable via the `__DEV__` entry —
   long-press the launcher title) still drives the adversarial fixtures and reports the trusted
   containment verdict; `npm run invariants` is 42/42 against the rebuilt runtime, and the diff
   shows **zero** changes to CSP, sandbox attributes, or the module allowlist.

## What "done" means

Every step above observed on-device, plus all desktop gates green (task 7.1). Record observed
behavior and any latency notes (the back-policy 400 ms window, the by-source deliver latency,
fork `switchLineage` cost) for the decisions.md as-built entry (task 7.3).
