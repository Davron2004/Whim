## Context

Versioning/rollback is first-class (Decision #23, spec §11) and happens far more often in vibe-coding than in normal coding, so it must be prominent and trustworthy. Decisions #33/#34 put the **device as the system of record** — a mini-app's source, manifest, and version history live on the phone — so versioning runs **on-device**. This change builds the **retained** on-device snapshot store: snapshot-per-generation, non-destructive rollback, pin, fork, history, and diff, all surfaced as product verbs with git never shown.

It is not exploratory. `spike-git-versioning` (Decision #36) already de-risked it and recorded the recipe; this build **consumes that lesson as input** and must not re-litigate it. Confirmed on-device (Pixel_9_Pro_XL arm64, RN 0.85.3 / Hermes / new arch, offline release bundle, 0 failures): `isomorphic-git` (v1.38.4) runs under Hermes over a JS filesystem shim and provides the full snapshot/fork/rollback/diff/history lifecycle driven 100% programmatically. **H2 wins**; server-side git (H1) is a fallback only; roll-your-own (H3) is off the table. The spike also handed forward, *as this change's work*, two items it deliberately did not finish: a persistent FS backend with **cross-app-restart persistence**, and a **DIY compaction** strategy (`isomorphic-git` has no `gc`/`prune`/`repack`).

**Scope is the code-versioning engine.** The repo holds the app's **code artifacts only** — never the user's runtime data. The spike named the consequence (a rolled-back bundle may meet a newer data shape — "schema drift") and deferred it here; this design takes the deliberate position that there is **no data persistence yet, so there is nothing to drift** — the engine is built now, the drift *seam* is set up, and drift *resolution* is left to the v0.2 storage layer.

## Goals / Non-Goals

**Goals:**
- Build the retained, host-side **per-mini-app version store** over on-device `isomorphic-git`, following the #36 recipe (FS shim + the Hermes polyfill set), driven entirely programmatically — git never surfaced.
- Surface the **product verbs** — snapshot (every generation), undo/rollback (non-destructive), pin known-good, fork (independent lineage), history, diff — satisfying the `mini-app-versioning` and `mini-app-forking` specs.
- Enforce the **code/data split**: the repo tracks code artifacts only (bundle source, manifest, `LEARNED.md`, prompt — plus any future declared-`schema` file, tracked like any other file); **rollback swaps code, never the user's data.**
- Land **persistent backing** so version history survives app restart (the spike's first handed-forward item), and a **DIY compaction** strategy that caps loose-object growth (the second).
- Keep forks as **permanently independent lineages** (no merge), per #36.

**Non-Goals:**
- **No runtime user-data / database persistence, and no schema-drift resolution.** There is no data store yet (storage-as-syscall-#1 is v0.2, §15.2); this change never reads or writes the user's data. Drift handling (migrating old-code-meets-new-data) is deferred to the v0.2 storage layer.
- **No server-side git** (H1 fallback only), no harness/LLM wiring — the store is exercised programmatically by a fixture; the generation loop wires in later.
- **No running git inside the WebView sandbox** — versioning is an RN-**host** concern (the sandbox change, `webview-sandbox-runtime`, owns the other side).
- **No rich launcher/history UI** — this change delivers the store + product-verb API and the minimum surface to exercise it; the polished version-history/rollback UX rides with the launcher (§10) and is deferred (same engine-now / UI-later split as the runtime).
- No merge, no binary/large-asset handling (Tier 0 is text), no device↔server concurrency (device is sole writer under Model 1).

## Decisions

### D1 — Mechanism: on-device `isomorphic-git` over a JS FS shim (consume #36)

`isomorphic-git` (v1.38.4) over a JS `fs` backend, loaded under Hermes with the proven polyfill set — **`buffer` + `text-encoding-polyfill` + a 3-line `process` shim, imported *before* isomorphic-git** (`pako`/`sha.js`/`crc-32` run as-is; Hermes ships `TextEncoder` but **not** `TextDecoder`, the spike's surprise). One **repo per mini-app** (clean fork isolation). H1 (server-side git) returns only if on-device proves unworkable or under a future Model 2; H3 is off the table. *Do not re-derive the polyfill recipe — it is recorded.*

### D2 — Scope boundary: code artifacts only; rollback never touches data

The version repo holds the app's **code artifacts** — bundle source, `manifest.json`, `LEARNED.md`, and the structured prompt — and **never** the user's runtime data. Code and data have different lifecycles, so **rolling back to an old code snapshot must never wipe or revert the user's data** (spec §11 / #36 D5). The store's API only ever materializes code artifacts into the active slot; it holds no handle to the (not-yet-built) data store. This boundary is the decoupling that makes the whole change proposable before the storage layer exists.

### D3 — Product-verb API over the git subset (git never surfaced)

A thin host-side API exposes only product verbs; the `isomorphic-git` vocabulary stays internal (a hard spec requirement — no terms, commands, or hashes ever reach the surface). The mapping (consume #36 D3):

| Product verb | Mechanism |
|---|---|
| snapshot (every generation) | `commit` (message = the structured prompt) |
| undo / rollback | `checkout` an earlier commit |
| pin known-good | `tag` |
| fork | `branch` **then** `checkout` — **two calls** (the #36 gotcha: `branch({checkout:true})` moves HEAD but does *not* materialize the working tree) |
| history | `log` (capped/paginated — `log` scales with depth) |
| diff two versions | `walk` + compare (`isomorphic-git` has no `git.diff`) |

The producing prompt is stored **both** ways — as the commit message (reads well in history) **and** as a tracked `prompt.md` (diffs, survives reformatting) — per #36; both work, keep both.

### D4 — Persistence: in-memory shim proven, MMKV serialize-to-KV is the lead, cross-restart is acceptance

The spike validated the **in-memory JS fs shim** (~120 lines, zero native modules) and measured real git-object byte counts on it; it explicitly did **not** validate cross-app-restart persistence or benchmark backends — *that is this change's work*. The lead is the spike's recommendation: **serialize the in-memory FS to MMKV/AsyncStorage** (KV-backed), keeping zero native FS surface. `react-native-fs`/`expo-file-system` are characterized alternatives but add native surface. **Surviving an app restart with the repo intact is the acceptance bar** that turns this from an engine into a *store*. (This is the version *store's* persistence — distinct from, and not coupled to, the user *data* persistence that stays a Non-Goal.)

### D5 — Compaction: DIY pack-then-drop-loose, triggered by loose-object count

`isomorphic-git` has **no `gc`/`prune`/`repack`**, so every object stays loose forever; #36 measured ~**4 loose objects per generation** (~812 at 200 gens) and confirmed `git.packObjects` packs 200 commits into a **28 KB packfile** on-device. Byte volume is a non-issue; **loose-object *count*** is the pressure (each is a key in the KV-backed FS). So compaction is **hand-built**: periodically pack reachable objects then drop the loose copies, **triggered by a loose-object-count threshold** (not byte size, not wall-clock) since count is the real cost driver. The trigger threshold is tunable (see Open Questions).

### D6 — The git layer is content-agnostic; the `schema` file is a forward seam

The store versions *whatever files are in the per-app repo* — it special-cases nothing. Today that is `{bundle, manifest, LEARNED.md, prompt}`. **When the v0.2 storage layer introduces a declared-`schema` artifact (the app's *data shape*, which is code — not the user's *data values*, which are not), it is tracked like any other file, for free.** Its diff across two snapshots is exactly the input a future migration step would read to reconcile old-code-meets-new-data. This sets up drift **detection** at zero cost now while drift **resolution** stays deferred (D2 / Non-Goals): there is no database yet, so nothing drifts. No schema-specific code is written in this change.

### D7 — Prove in Node, accept on-device (consume #36 D6)

Git mechanics, the verb API, the no-merge property, and compaction are cheap to verify in plain Node (normal/`memfs` FS) for fast iteration and unit tests — and that core is **pure JS, so it can be built and tested independently of the RN app**. But the acceptance that counts (Hermes load, the persistent KV backend, cross-restart integrity, on-device storage growth) runs on the **RN/Hermes Android target**; Node-green is a checkpoint, not a pass.

## Risks / Trade-offs

- **[Unbounded loose-object growth — no native gc]** → DIY pack-then-drop-loose compaction (D5), triggered by loose-object count; the proven `packObjects` path makes it viable on-device.
- **[Cross-restart persistence corrupts the repo / MMKV serialization round-trips badly]** → this is the spike's handed-forward unknown; exercise repeated commit/checkout **plus restart** cycles and assert repo integrity (the D4 acceptance bar). If KV-backed FS proves unreliable, fall back to a native FS backend (characterized, adds native surface).
- **[Rollback accidentally reverts the user's data]** → the hard code/data boundary (D2): the store's API materializes code artifacts only and holds no handle to the data store; data lives in a separate v0.2 subsystem the store never writes.
- **[Schema drift bites once data persistence lands]** → acknowledged and deferred (Non-Goals); the content-agnostic `schema`-file seam (D6) sets up future *detection* now, but *resolution* (migration on rollback) is v0.2 storage work — and with no database today, nothing drifts yet.
- **[Deep-history latency: `log` and `checkout` scale with depth]** → consume #36's numbers (snapshot 2.5 ms, diff 0.8 ms, history ~46 ms, rollback ~166 ms on ~290 commits); cap/paginate history and accept rollback in the tens-to-~150 ms range — all well under a second.
- **[Git concepts leak into the UX]** → the product-verb API (D3) is the only surface; "git never exposed" is a hard spec requirement, asserted in tests.
- **[Building ahead of the harness caller]** → "snapshot every generation" implies the LLM, which doesn't exist yet; the store is driven by a programmatic fixture (as the spike was) and the real generation loop wires in during the harness phase.

## Migration Plan

This is the first **retained** versioning code (the spike was doc-only), so there is no in-place data migration — "deploy" is standing up the host-side store module and the on-device acceptance run.

- **Dependency:** the store lives in the RN app that `webview-sandbox-runtime` bootstraps (its task 1). Its **pure-JS core** (git-over-fs, verbs, compaction) is Node-testable independently, so it can be built/tested in parallel and dropped in once the shell exists; only the MMKV backing + cross-restart acceptance need the device.
- **Rollback** is clean: revert the module — no users, and (by D2) no user data is ever touched.
- **On archive**, `mini-app-versioning` and `mini-app-forking` fold into `openspec/specs/` as the system's source of truth.
- **Forward seam:** the content-agnostic repo (D6) carries a future `schema` artifact with no code change; drift resolution is picked up by the v0.2 storage layer.

## Open Questions

- **Does persistent backing land in *this* change or a follow-up?** Leaning *this change* — a version store that doesn't survive restart isn't really a store (D4). (User's "worry about persistence later" was about *user-data/database* persistence, which is out of scope regardless; confirm the version-store persistence stays in.)
- **Compaction trigger threshold** — at what loose-object count (or generations-since-last-pack) does compaction fire? Pick a default from #36's ~4-objects/gen curve; make it tunable.
- **Pin = lightweight vs annotated tag** — annotated can carry "user marked this good" + a timestamp; lightweight is simpler and the prompt already lives in the commit. Lean lightweight unless the pin needs its own metadata.
- **Who owns drift-resolution when the `schema` artifact arrives?** Deferred to the v0.2 storage layer; named here so the seam isn't forgotten.
- **Diff/history UX depth** — what "diff" means to a non-coder (a code diff is meaningless to most users). Rich presentation is deferred with the launcher UI; this change exposes the diff *data* via the verb API.
