## 1. Mechanism proof in Node (fast iteration, not the pass)

- [x] 1.1 Create a throwaway Node script in a scratch dir — mark it clearly as spike code, not the v0.2 on-device store
- [x] 1.2 Run `isomorphic-git` over a plain/`memfs` FS; init one per-mini-app repo programmatically (no human git commands)
- [x] 1.3 Define the repo-contents fixture: code artifacts only — sample bundle source, manifest, `LEARNED.md`, structured prompt; deliberately NO runtime user data (D5)
- [x] 1.4 Walk the full lifecycle in Node — commit ×2 (prompt as message) → branch (fork) → divergent commit → checkout (rollback) → tag (pin) → diff → log — and confirm the no-merge flow (D4). This is the cheap correctness checkpoint, not acceptance.

## 2. On-device harness: get isomorphic-git running under Hermes (the load-bearing part)

- [x] 2.1 Stand up a throwaway RN host screen (git runs in the RN host JS context, NOT the WebView sandbox)
- [x] 2.2 Get `isomorphic-git` to load and run under Hermes — resolve polyfills (`Buffer`, any Node-isms); record the minimal set (D2)
- [x] 2.3 Pick and wire the FS backend (`react-native-fs` / `expo-file-system` / in-memory over MMKV/AsyncStorage); record which works and why (D2)
- [x] 2.4 Init a per-mini-app repo in on-device storage via the chosen FS backend

## 3. Full lifecycle on-device (mini-app-versioning)

- [x] 3.1 Commit "generation 1" with the producing prompt as the message (and/or a tracked file — resolve where the prompt lives)
- [x] 3.2 Modify the bundle and commit "generation 2"; read history (`log`) — both snapshots appear in order, each showing its prompt
- [x] 3.3 Roll back to gen 1 (checkout); confirm gen 1's bundle is active and gen 2 is still recoverable (non-destructive)
- [x] 3.4 Pin gen 1 (tag); create more generations; confirm the pinned version is still retrievable by its label and unchanged
- [x] 3.5 Diff gen 1 vs gen 2; confirm the bundle change is shown clearly
- [x] 3.6 Map each operation to its product verb per D3; assert no raw git terms/hashes are required to express it

## 4. Fork + no-merge on-device (mini-app-forking)

- [x] 4.1 Fork from gen 1 (branch) into an independent lineage
- [x] 4.2 Commit divergently on the fork; confirm the original lineage's snapshots are unchanged, and vice versa
- [x] 4.3 Walk the fork-and-diverge flow and confirm no operation ever wants or requires a merge (D4); if merge feels necessary, record it as a reject condition

## 5. On-device storage growth + reliability (the real risk); latency (just a number)

- [x] 5.1 Create many generations on the device and measure storage growth; note whether `isomorphic-git` gc/packing is viable on-device or a compaction strategy is needed (a top risk)
- [x] 5.2 Exercise repeated commit/checkout cycles to surface any FS-backend corruption/reliability issues
- [x] 5.3 Measure on-device latency of snapshot, rollback, pin, diff, and history against a realistic Tier-0 bundle; record the numbers (expected fine for kilobyte bundles — a measurement, not the headline fear)

## 6. Record the lesson, then delete the code

- [x] 6.1 Write the artifact into `docs/decisions.md`: the FS-backend + Hermes-polyfill recipe, the operation→UI-verb mapping, confirmation that merge is unnecessary, repo contents + where the prompt lives, on-device latency numbers, and the storage-growth/gc note
- [x] 6.2 Add a `DEVLOG.md` capture entry with the same lesson plus dead ends / surprises (e.g. polyfills that fought back)
- [x] 6.3 If H2 was rejected (won't run under Hermes, too slow on-device, or FS unreliable), record the failure and escalate to H1 (server-side git, network-dependent versioning) or H3 (roll-your-own) rather than forcing it here — N/A: **H2 was ACCEPTED**, so no escalation needed; reject conditions (won't load / too slow / FS corruption) were all probed and none triggered
- [x] 6.4 Delete the throwaway spike code; the v0.2 on-device snapshot store is built properly from the recorded lesson
