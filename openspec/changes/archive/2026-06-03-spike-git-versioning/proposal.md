## Why

Versioning and rollback are first-class in Whim (Decision #23, spec §11): every generation is a snapshot, undo goes back a step, users pin known-good versions, and rollback must be prominent and trustworthy. Decisions #33 and #34 then settled *where* that history lives: the server is stateless and the **device is the system of record** — app source, bundle, manifest, data, and **version history all live on the phone**. So the versioning engine must run **on-device**, and `isomorphic-git` (pure-JS git over a JS filesystem shim) is the lead. This is Spike 4.

The decision flip changes what this spike de-risks. Server-side git was low-risk (git is proven; the server is already in the loop). On-device git is **not** — the real unknowns are now: *does `isomorphic-git` even load and run correctly under Hermes (once `Buffer`/Node-isms are polyfilled), and does on-device storage stay manageable across many generations, given how weak on-device gc/packing is?* Per-operation latency on kilobyte Tier-0 bundles is almost certainly fine — a number to measure, not the headline fear.

This is a **spike**, not a feature. The deliverable is the *lesson* — which FS backend works under Hermes, the operation→UI-verb mapping, confirmation that merge is never needed, and on-device latency / storage-growth numbers — recorded durably; the code is throwaway and gets deleted once the lesson is captured. The discipline is scope and disposability (build only what answers the unknown; don't treat the harness as the real v0.2 on-device store), not deliberate scrappiness.

## What Changes

- Stand up a throwaway harness that drives `isomorphic-git` entirely programmatically (no human git commands) through the full lifecycle on a per-mini-app repo: init → commit two "generations" with the producing prompt as the commit message → branch ("fork") → commit divergently → check out an old commit ("rollback") → tag ("pin") → diff two versions → log ("history").
- Prove the git mechanics + no-merge cheaply in **Node first** (fast iteration), then port to the **load-bearing target — the RN host JS context (Hermes)** where the acceptance actually counts (mirroring Spike 1's "verify on the real target, not the easy one" discipline).
- Get `isomorphic-git` running under **Hermes** (resolve polyfills — `Buffer`, etc.) and choose the **FS backend** beneath it (`react-native-fs` / `expo-file-system` / an in-memory FS over MMKV/AsyncStorage).
- Validate the **operation→UI-verb mapping** (snapshot=commit, undo/rollback=checkout, pin=tag, fork=branch, diff=diff, history=log), with git vocabulary never reaching the UX.
- Decide **repo contents** (bundle source, manifest, `LEARNED.md`, structured prompt) and where on the device they live.
- Confirm the **no-merge simplification** — forks are independent lineages (#33 notes this is what keeps on-device git tractable).
- Measure **on-device latency** per operation and **storage growth** over many generations on the phone.
- Record the artifact in `docs/decisions.md` (+ a `DEVLOG.md` capture), then **delete the spike code.**
- Lead hypothesis **H2 — on-device `isomorphic-git`**. Documented fallbacks: **H1** (server-side git, accepting network-dependent versioning) only if on-device perf/FS proves unworkable; **H3** (roll-your-own content-addressed snapshot list) as last resort.

## Capabilities

### New Capabilities
**None.** This is a throwaway de-risking spike: it validates an approach and produces a decision + recipe, then deletes its code. It ships **no retained behavior**, so it declares no capabilities and folds nothing into `openspec/specs/`. Its retained outputs are documentation only — a `docs/decisions.md` entry and the Hermes/FS-backend recipe in `DEVLOG.md`.

Tooling note: because it has no spec deltas, `openspec validate` reports `CHANGE_NO_DELTAS` for this change. That is the **correct** state for a doc-only spike, not a defect — OpenSpec models every change as having ≥1 capability delta, which a throwaway spike legitimately does not. Archive it doc-only with `openspec archive spike-git-versioning --skip-specs --no-validate`.

The versioning and forking capabilities this spike de-risks are **researched and validated, not built** here — the spike confirms the approach is viable and hands a recipe forward, but ships nothing the system retains. Their capability specs live in the downstream change **`on-device-snapshot-store`** (the v0.2-era build that actually implements and *retains* the on-device store), which consumes this spike's lesson as input.

### Modified Capabilities
None.

## Impact

- **New (throwaway) code:** a small RN host harness, `isomorphic-git`, an FS adapter (`react-native-fs` / `expo-file-system` / in-memory over MMKV/AsyncStorage), and any Hermes polyfills. Git runs in the **RN host JS context, not the WebView sandbox** (versioning is a host concern). Discarded after the lesson is recorded.
- **Durable artifacts produced:** a decisions-log entry + DEVLOG capture; the working FS-backend + Hermes-polyfill recipe; the operation→UI-verb mapping; confirmation that merge is unnecessary; on-device latency and storage-growth numbers.
- **Decisions informed:** #33 (Model 1, device as system of record), the §11 versioning/rollback model, and the v0.2 on-device snapshot-store shape.
- **Downstream unblocked:** the `on-device-snapshot-store` change (the v0.2-era build that implements and retains versioning/forking) and the versioning/rollback UX (§11).
- **Coupling:** conceptually independent of Spike 1's sandbox/isolation work, and the git mechanics + no-merge proof can run in Node **in parallel** — but the load-bearing acceptance (Hermes + on-device FS + perf) needs the RN target. Server-side git (the old lead) is off the v1 path unless H2 fails; it only fully returns under Model 2 (#33), which is deferred.
