## Context

Versioning/rollback is first-class (Decision #23, spec §11) and happens far more often in vibe-coding than in normal coding, so it must be prominent and trustworthy. Git already provides commit/branch/checkout/tag/diff/log — exactly the operations Whim needs. The open question was *where* git runs, and Decisions #33 + #34 settled it: the server is stateless and the **device is the system of record** (app content and version history live on the phone; the phone owns what's stable, the server owns what's volatile). So versioning runs **on-device**, which makes `isomorphic-git` (pure-JS git over a JS FS shim) the lead and demotes server-side git to a fallback. The repo is docs-only today; there is no storage layer yet.

This is a throwaway de-risking spike: the deliverable is the *lesson* (the FS-backend + Hermes recipe, the operation→UI-verb mapping, confirmation merge is unnecessary, on-device latency/storage numbers), not the code — which is deleted once the lesson is captured. The discipline is **scope and disposability**: build only what answers the unknown, keep it clean enough to trust the result, and don't treat the harness as the real v0.2 on-device store.

## Goals / Non-Goals

**Goals:**
- Prove the lead hypothesis **H2**: `isomorphic-git` runs under **Hermes** over a JS FS shim and provides the full snapshot/fork/rollback/diff/history lifecycle on-device, driven programmatically, with git never surfaced to the user.
- Find the **FS backend** that works beneath `isomorphic-git` on RN/Hermes, and the **polyfill set** needed to load it.
- Validate a clean **operation→UI-verb mapping** end to end.
- Confirm the **no-merge simplification** — forks are independent lineages, so merge is never needed (#33 notes this is what keeps on-device git tractable).
- Measure **storage growth** over many generations (a top risk — on-device gc/packing is weak) and **per-operation latency** (expected fine for Tier-0 kilobytes — a number to record, not the headline fear).
- Decide **repo contents** (bundle source, manifest, `LEARNED.md`, structured prompt) and on-device storage location.

**Non-Goals:**
- No server-side git (that is the H1 fallback, not the lead), no harness wiring, no LLM, no UI.
- No running git inside the WebView sandbox — versioning is an **RN-host** concern; the host owns the version store.
- No concurrency between device and server commits — the device is sole writer in Model 1, which removes the race by construction.
- No binary/large-asset handling — Tier 0 is text; note it for later, don't solve it.
- No reusable on-device storage abstraction; this harness is thrown away.

## Decisions

### D1 — Git location: H2 (on-device `isomorphic-git`) is now the lead

Reordered by #33/#34 (the source spikes.md is already updated to "Leading hypothesis: H2, on-device"):

- **H2 — on-device `isomorphic-git` over a JS FS shim.** Chosen lead. Version history must live on the device (device is system of record), and `isomorphic-git` is the pure-JS, FS-agnostic git that runs in Hermes/RN. Cost/risk: it is a JS reimplementation (a subset of git), so **whether it loads and runs correctly under Hermes, and how its storage footprint grows on-device, are the spike's primary unknowns** — raw per-operation latency on Tier-0 kilobytes is expected to be fine and is just measured.
- **H1 — server-side git (e.g. `simple-git`/system binary, repo per app).** Fallback only. Reachable, robust, fast — but it makes versioning network-dependent and contradicts Model 1's "history lives on the device." Returns to the table only if H2's on-device perf/FS proves unworkable *and* network-dependent versioning is accepted, or later under Model 2 (server persists bundles), which #33 defers.
- **H3 — roll-your-own content-addressed append-only snapshot list.** Last resort. Trivial to start but reimplements the forking/diff git gives for free; only if both git paths prove wrong.

### D2 — FS backend + Hermes compatibility (the load-bearing sub-decision)

`isomorphic-git` needs an `fs` implementation and a working Hermes runtime. Evaluate, pick the simplest that's reliable, and record it:
- **FS backends:** `react-native-fs` (real device files), `expo-file-system` (if Expo), or an in-memory FS persisted to MMKV/AsyncStorage. Browser-oriented `lightning-fs` (IndexedDB) likely does **not** fit Hermes — note if confirmed.
- **Hermes polyfills:** `isomorphic-git` expects `Buffer` and a few Node-isms; resolve what's missing (`buffer` package, etc.) so it loads and runs. This recipe is a core deliverable.

### D3 — Operation→UI-verb mapping (git vocabulary never reaches the UX)

| Product verb | Git mechanism (`isomorphic-git`) |
|---|---|
| snapshot (every generation) | commit |
| producing prompt | commit message (and/or a tracked file — see Open Questions) |
| undo / rollback | checkout an earlier commit |
| pin known-good | tag |
| fork | branch |
| diff two versions | diff (walk + compare) |
| history | log |

### D4 — No merge, ever

Forks are independent lineages, so the model never merges — dropping git's hardest, most failure-prone feature and leaving the rock-solid subset (init, commit, branch, checkout, tag, diff, log), which is also the subset `isomorphic-git` implements most reliably. The spike confirms no merge is wanted by walking the fork-and-diverge flow.

### D5 — Repo contents: code artifacts only, NOT runtime user data

One repo per mini-app holding the app's **code artifacts**: bundle source, manifest, `LEARNED.md`, and the structured prompt. Per-app repos keep fork isolation clean — confirm during the spike.

The version repo MUST NOT contain the app's **runtime user data** (the storage the running mini-app reads and writes). Code and data have different lifecycles: **rolling back to an old code snapshot must never wipe or revert the user's data.** So data lives outside the git repo and is versioned independently (or not at all).

This raises an **old-code-meets-current-data schema-drift** question — a rolled-back bundle may expect a different data shape than what is currently on disk. That is real but **out of scope for this spike** (it's a v0.2 storage-design problem, for `on-device-snapshot-store`). Named here so it isn't forgotten.

### D6 — Prove in Node first, accept on-device

The git mechanics and the no-merge property are cheap to verify in plain Node (with a normal/`memfs` FS) for fast iteration. But — exactly as Spike 1 refused a desktop-Chrome pass — the **acceptance that counts runs on the RN/Hermes target over the real FS backend**, because Hermes compatibility and on-device storage behavior are the actual unknowns. Node-green is a checkpoint, not a pass.

## Risks / Trade-offs

- **[`isomorphic-git` won't load/run under Hermes]** (top risk — missing `Buffer`/Node-isms, or other engine gaps) → resolve polyfills in D2; if it fundamentally can't run on-device, that's an H2 reject → escalate to H1.
- **[Storage growth on the phone]** (the other top risk — on-device gc/packing is weak) → measure footprint across many generations; note whether `isomorphic-git` packing/gc is viable on-device or a compaction strategy is needed. Unmanaged growth is an H2 reject condition.
- **[FS-backend reliability/corruption on the device]** → exercise repeated commit/checkout cycles; pick the backend that survives; note any corruption.
- **[Per-operation latency]** (not the headline — Tier-0 bundles are kilobytes of text, so `isomorphic-git` is almost certainly fast enough) → measure it and record the numbers; a concern only if a number comes back surprisingly bad, in which case H1/H3.
- **[A real need for auto-merge surfaces]** → would break D4; probe via fork-and-diverge and confirm none is wanted.
- **[Git concepts leaking into the UX]** → D3 keeps every operation a product verb; "git never exposed" is a hard requirement of the future `on-device-snapshot-store` build.
- **[Binary/large assets]** → Tier 0 is text; out of scope, record as future concern.

## Migration Plan

Not applicable in the deploy sense — nothing ships. The "migration" is knowledge transfer: on completion, write the artifact (the FS-backend + Hermes recipe, operation→UI-verb mapping, merge-unnecessary confirmation, on-device storage-growth + latency numbers) into `docs/decisions.md` plus a `DEVLOG.md` capture, then delete the spike code. This change declares **no capabilities**, so archive it doc-only with `openspec archive --skip-specs` — nothing folds into `openspec/specs/`. The `on-device-snapshot-store` change builds the real store properly from that lesson.

## Open Questions

- Which FS backend wins under Hermes (`react-native-fs` vs `expo-file-system` vs in-memory-over-MMKV/AsyncStorage), and what is the minimal polyfill set?
- Does the structured prompt live in the commit message, a tracked file, or both? (Message reads well in `log`; a file diffs and survives reformatting.)
- Pin = lightweight tag vs annotated tag (annotated can carry "user marked this good" metadata)?
- One repo per mini-app vs one store with a directory per app — confirm per-app repos for fork isolation.
- Is on-device gc/packing in `isomorphic-git` viable, or does storage growth force a periodic compaction strategy?
- Exact interactive latency ceiling on-device — record the real numbers and decide if any operation needs optimization.
