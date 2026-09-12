# Whim — Backlog (deferred findings & cleanups)

Durable home for **small, deferred work**: low/med reviewer & critic findings, "real-but-hard"
items, cleanups, and outstanding manual checks. The granularity here is a finding or a one-off
fix — *not* a feature. Big planned changes live in `docs/v1-roadmap.md`; raw lessons live in
`DEVLOG.md`; daily critic output lives in `openspec/critic/`. This file is meant to be
**agent-actionable**: each item names where, what, and a suggested approach, so a future
dispatch can pick it up (often as an OpenSpec change, or a quick fix).

Convention per item: `### [severity] title` · **Where** · **What** · **Why it matters** ·
**Suggested approach** · **Source** (where the finding came from). Check the box when done.

---

## Open

### [low] DevProbeScreen may double-apply the top safe-area inset
- [ ] open
- **Where:** `src/host/launcher/DevProbeScreen.tsx` (uses `react-native`'s `SafeAreaView`), now rendered under `App.tsx`'s `SafeAreaView edges={['top']}` (added by `fix-launcher-shell-bugs` B9).
- **What:** nested top-inset wrappers could double-pad the dev probe screen.
- **Why it matters:** dev-only surface; on the Android-first target RN's `SafeAreaView` injects no top inset, so it does **not** manifest today — purely latent. Would surface on iOS or if RN's inset behavior changes.
- **Suggested approach:** drop the inner `SafeAreaView` in `DevProbeScreen` (the App-level wrapper already covers it), or switch it to `react-native-safe-area-context` consistently.
- **Source:** reviewer, `fix-launcher-shell-bugs` (2026-06-13).

### [med] The `researcher` agent can't write its own digest
- [ ] open
- **Where:** `.claude/agents/researcher.md` (`tools: Read, Grep, Glob`), `docs/archive/harness-build-guide.md`, `openspec/schemas/whim-harness/schema.yaml` (research artifact instruction).
- **What:** the guide and the schema instruction both tell the researcher to write `research.md`, but it has no Write tool, so the proposer must paste its final message instead.
- **Why it matters:** silent contract mismatch; every proposal pays a manual paste step and the instruction reads as if the subagent does it.
- **Suggested approach:** either grant the researcher scoped Write (change-folder only) or reword the guide + schema instruction to "return the digest; the proposer saves it."
- **Source:** harness guinea-pig run, `fix-launcher-shell-bugs` (2026-06-13).

### [low] Physical-hardware acceptance outstanding for launcher-shell & effects-and-cues
- [ ] open
- **Where:** `launcher-shell` task 7.2, `effects-and-cues` task 8.1.
- **What:** both verified on the Pixel emulator (offline release); the *felt* checks — real taps latency, haptic buzz, audio cue tone — need a run on a physical Android phone.
- **Why it matters:** the emulator can't reproduce the haptic/audio sensation (design device policy); it's the last "real verdict" gap.
- **Suggested approach:** `npm run android:release` on the physical device; walk `src/host/launcher/test/acceptance.spec.md` and the pour-over cue check; record felt-latency notes in DEVLOG.
- **Source:** archived-change acceptance, 2026-06-13.

### [low] Remove RN-template dependency leftovers
- [ ] open
- **Where:** `@react-native/new-app-screen`, `react-test-renderer` (+ `@types/react-test-renderer`) — currently in `knip.json` `ignoreDependencies` to keep the gate green.
- **What:** unused RN-template scaffolding deps; knip's one *real* finding, suppressed.
- **Why it matters:** dead deps bloat install and muddy the "what do we actually use" signal.
- **Suggested approach:** confirm no remaining importer, remove the deps + their knip ignores, re-run the gate.
- **Source:** `whim-build-harness` memory / knip.

### [med] effects-and-cues runtime-owner invariants not yet authored
- [ ] open
- **Where:** `effects-and-cues` tasks 7.1 (INV-TIMER) and 7.2 (INV-CUEGATE).
- **What:** the timer-teardown and cue-gating never-regress invariants are deliberately left for a runtime owner (feature agents must never author invariants). Until authored, the change can't be cleanly archived.
- **Why it matters:** these guard timer-leak and cue-forgery regressions across the bridge boundary — load-bearing safety assertions.
- **Suggested approach:** runtime owner authors INV-TIMER (gen-1 interval ticks die after realm reset) and INV-CUEGATE (undeclared cue syscalls denied, forged sysret inert) in the `bridge:invariants` hostile-bundle suite with a non-vacuous negative control; then archive the change.
- **Source:** `effects-and-cues` change (open by design).

### [deferred — critic rated high] Orphaned loose git objects from an interrupted snapshot are never reclaimed
- [ ] open
- **Where:** `src/host/version-store/engine.ts:194-206` (snapshot writes loose blobs via `git.add` before `git.commit`), `src/host/version-store/compaction.ts:90-93` (deletion loop is guarded by `if (reachable.has(oid))`, so it only frees *packed* reachable objects and skips loose objects unreachable from any ref).
- **What:** if `snapshot()` is interrupted between the first `git.add` and the `git.commit` (a `writeFile` failure, an isomorphic-git throw, or the app/process being killed mid-write), loose blob objects land in the FS/KV backend with no commit referencing them. `compactRepo()` never unlinks unreachable loose objects, so these orphans accumulate in KV indefinitely — partially defeating the loose-object-count pressure argument the compaction design rests on.
- **Why it matters / why deferred:** the critic rated this **high** (a slow on-device space leak). **Ratified wontfix-for-now (2026-06-18):** it only triggers on a snapshot interrupted mid-write — rare in practice — and it leaks KV *space*, not correctness (no snapshot or history is lost). Real, but not now. **Revisit if** device KV key-count growth is observed in acceptance, or before any change that makes snapshots larger or more frequent.
- **Suggested approach:** after compaction packs reachable objects, add a second pass that unlinks loose objects **not** in `reachable` (true GC — safe, they are unreferenced by definition); or add a device-acceptance measurement that surfaces orphan-object growth so the leak is observable before it bites.
- **Source:** critic baseline 2026-06-18 (finding **C2**, full text in `openspec/critic/2026-06-18.md`); adjudicated wontfix-for-now in `openspec/critic/2026-06-18-triage.md`.

### [med] static-check-pipeline chain-A is blocked on human-only bootstrap edits
- [x] closed 2026-07-12 — chain-A bootstrap edits were human-ratified and committed (`4d63bc9`); the change is complete, merged (PR #4), and archived.
- **Where:** `openspec/changes/archive/2026-07-12-static-check-pipeline/chains.md` chain-A; root `package.json`; root `tsconfig.json`.
- **What:** chain-A's two bootstrap edits — adding `"checks:test": "node checks/test/run.mjs"` to root `package.json` and `"checks/test"` to root `tsconfig.json`'s `exclude` — are blocked by `.claude/hooks/protect-harness.sh` (it protects `*/package.json` and `tsconfig*.json`) and must be made by a human in an editor before any chain can be dispatched.
- **Why it matters:** the whole static-check-pipeline change is stalled until this lands.
- **Suggested approach:** human makes both edits, then dispatch chain-B.
- **Source:** `static-check-pipeline` chains.md chain-A note.

### [low] A finished build lands in a different grid slot than its ghost
- [ ] open
- **Where:** `src/host/launcher/HomeScreen.tsx` grid ordering; `src/host/launcher/app-tile.tsx` (ghost vs finished tile).
- **What:** while building, the ghost tile sits in slot 1 (ahead of the three example tiles). When the build lands, the finished tile appears in slot 4, after the examples, and the examples shift back. Seen in both the 2026-09-04 and 2026-09-11 demo shoots (`demo/raw/2026-09-11/shot-1`, raw take at ~477 s).
- **Why it matters:** the "transmute" moment, the one beat every demo is built around, reads as a jump, not a morph. It also breaks the user's mental model of where the app went.
- **Suggested approach:** give the ghost the slot the finished app will occupy (sort by creation time consistently for both states), or keep the finished app in the ghost's slot.
- **Source:** demo shoot 2026-09-11 (orchestrator review of shot 1); first noted in `demo/raw/PROGRESS.md` take-3 notes.

### [low] Generated apps mislabel derived state (a "Preset" pill that survives a custom value)
- [ ] open
- **Where:** generation quality, not host code: `server/src/generation/prompts/index.ts` (engineer prompt), evals in `docs/evals.md`.
- **What:** the 2026-09-11 demo instance ("Tea Steeper") keeps a `Preset` pill next to the tea name on its card after the steep time was changed from the preset 180 s to 440 s, while its adjust screen correctly flips `Selected Green` to `Saved`. The same generation asks for plan-row eyebrows (`THE SCREEN` etc.) that the host renders verbatim from the model reply, so a run that drops or renames a label changes the plan screen's structure.
- **Why it matters:** small inconsistencies like this are what make a generated app feel generated. The plan-row point also means demo flows can't gate on those labels (the 2026-09-11 flows now gate on the host's `Build it` instead).
- **Suggested approach:** add a "derived labels stay consistent after edits" check to the eval corpus; consider making plan-row eyebrows host copy keyed by row kind rather than model text.
- **Source:** demo shoot 2026-09-11 (shot 2 payoff frame; shot-1 flow review).

### [high] Rewrite loops on `storage_surface_drift` when the model reaches kv keys through an alias
- [ ] open
- **Where:** `checks/storage-surface.ts:15-19` (documented alias hole), `checks/passes/storage-continuity.ts:81-93` (dynamic-suppression trigger), `server/src/generation/machine.ts:672` (repair loop).
- **What:** a "Prompt again" rewrite of a working v1 ("add a strength selector…", 2026-09-11 demo shoot, server log `~/.cache/whim-readme/server.log` lines 225-337) failed after three rounds. Round 1 was a parse error (see next item); rounds 2-4 each produced the same eight `storage_surface_drift` errors. The candidate kept every kv key but read them through a helper, so `scanStorageSurface` collected nothing, no `storage_surface_dynamic` warning fired, and all eight keys read as abandoned. The repair hint ("Keep reading the kv key X") describes what the model already does, so repair changes nothing.
- **Why it matters:** a deterministic failure on a legitimate rewrite, and the user pays ~10 minutes and three model calls to learn nothing. Rewrites are the feature that distinguishes Whim from one-shot generators.
- **Suggested approach:** resolve simple aliases in the scanner, or fire the dynamic-suppression path whenever storage access is not facade-shaped; and cap identical-diagnostic repair rounds at one.
- **Source:** demo shoot 2026-09-11, server-side diagnosis (opus subagent) of the failed `/v1/generate` at 01:47 UTC.

### [med] No fence or prose stripping between the model reply and the TypeScript checker
- [ ] open
- **Where:** `server/src/generation/machine.ts:606` and `:643` (`turn.text` returned verbatim to `runStaticChecks`), `checks/internal/parse.ts:33`, `server/src/generation/json-block.ts:17` (a `FENCE` regex that already exists but is used only for JSON turns).
- **What:** the prompts ask for "source only, no fence", but nothing enforces it. A fenced or prose-wrapped reply goes straight into `ts.createSourceFile` and burns a whole repair round on 17 identical `parse_error` hints (round 1 of the failure above).
- **Why it matters:** one wasted round per fenced reply, on every model that is casual about fences.
- **Suggested approach:** unwrap a leading/trailing code fence (and drop a leading prose line) before the checker, reusing the `FENCE` regex.
- **Source:** same diagnosis as above.

### [med] The failure screen shows the run's cumulative findings, not the last round's
- [ ] open
- **Where:** `server/src/generation/machine.ts:402` (terminal failure ships `state.diagnostics`, accumulated at `:775`), `src/host/launcher/copy.ts:455`, `src/host/launcher/run-timeline-view.ts:141` (one row per hint, no dedup, no kind), `src/host/launcher/run-journal.ts:42` (drops `Diagnostic.message`, keeps the hint only).
- **What:** after a multi-round failure the device lists round 1's 17 syntax-error hints above the 8 drift hints that actually killed the run, so the headline reads "Fix the TypeScript syntax error" for a run that died on something else. The real TypeScript message never reaches disk anywhere (server logs kind counts only; `source`/`code` are pino redact paths).
- **Why it matters:** misdirects the user ("try describing it differently") and anyone debugging; today it cost a diagnosis pass to find the real cause.
- **Suggested approach:** ship only the last round's diagnostics in the terminal event (or tag each with its round and show the last), dedupe identical hints with a count, and keep `Diagnostic.message` in the journal.
- **Source:** same diagnosis as above.

### [low] Fork tile subtitle truncates on the grid ("Forked from Tea Ste…")
- [ ] open
- **Where:** `src/host/launcher/app-tile.tsx` (tile caption/subtitle), `src/host/launcher/HomeScreen.tsx` (three-column grid).
- **What:** a fork's "Forked from <name>" subtitle is cut to one line under a three-column tile, so any parent name longer than about eight characters ends in an ellipsis (2026-09-11 shoot, `demo/raw/2026-09-11/shot-5`).
- **Why it matters:** the fork relationship is the one thing that subtitle exists to say, and it is unreadable for most names.
- **Suggested approach:** drop the "Forked from" prefix on the tile (keep it in the action sheet/History), or allow two lines for the subtitle.
- **Source:** demo shoot 2026-09-11, shot 5 review.

### [low] Generated apps flash default values for one frame before saved state hydrates
- [ ] open
- **Where:** generated-app pattern (the mini-app renders its defaults, then reads kv and re-renders); SDK surface for persisted state (`src/sdk/`), engineer prompt in `server/src/generation/prompts/index.ts`.
- **What:** on a cold open, the 2026-09-11 demo instance shows "3:00" for one frame (≤ 0.1 s) before the saved "7:20" lands; measured at 30 fps in `demo/out/linkedin-2026-09-11.mp4` sources (shot 3 reopen, shot 4 payoff). Warm opens don't flash.
- **Why it matters:** a one-frame wrong value on the exact beat that demonstrates persistence; a viewer who pauses sees the app "forgetting". Any generated app with a saved setting has the same pattern.
- **Suggested approach:** give the SDK a way to render persisted state without a default-first paint (a synchronous initial read, or a "loading" gate the engineer prompt is told to use), and add an eval that diffs the first painted frame against the settled one.
- **Source:** demo shoot 2026-09-11, final-cut frame review.

### [idea — post-v1] Account sync: back up apps and their data, use them across devices
- [ ] open
- **Where:** new capability; touches the version store (`src/host/version-store/`, the per-app snapshot repo), the storage engine (`src/host/storage-engine/`, per-app SQLite user data), and a server side that does not exist yet (`server/` is the generation stub only).
- **What:** a signed-in account that backs up every app's version history and its user data, so the same apps with the same state show up on another phone after logging in. Today everything lives on one device and is lost with it.
- **Why it matters:** it is the one thing Whim could reasonably charge for later. Generation is bring-your-own-key and stays free; hosted backup and cross-device sync is the paid-tier candidate. Not a commitment, and not for v1.
- **Suggested approach:** the version store already speaks in snapshots, so sync is push/pull of those plus a storage-engine export; decide identity (account provider), conflict rule (last-writer-wins per app is probably enough for an audience of one), and what "delete my account" means before writing any code. Needs its own OpenSpec change when picked up.
- **Source:** conversation while writing the launch post, 2026-09-12.

---

## Done

<!-- Move items here with a one-line resolution + date when closed. -->
