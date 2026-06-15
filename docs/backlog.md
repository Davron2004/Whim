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
- **Where:** `.claude/agents/researcher.md` (`tools: Read, Grep, Glob`), `docs/harness-build-guide.md`, `openspec/schemas/whim-harness/schema.yaml` (research artifact instruction).
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

---

## Done

<!-- Move items here with a one-line resolution + date when closed. -->
