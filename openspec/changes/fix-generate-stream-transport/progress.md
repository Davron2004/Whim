# Progress ledger — fix-generate-stream-transport

Append-only. Every disposition recorded as it happens.

## Run parameters

- `run-start` 2026-07-31 — schema `whim-harness`, dispatch loop.
- **Base override (human instruction):** this run branches from `v1-sprint`, not `main`.
  `V1_SPRINT_TIP = 26d6fd545c5452242000f12d4580c8ee17b5897e`.
  Staging branch `integration/fix-generate-stream-transport` cut from that tip.
  Closure opens its PR into `v1-sprint`.
- `FIXLOOP_INTEGRATION_BRANCH=integration/fix-generate-stream-transport` for every fixloop.sh call.
- Planning artifacts committed to the staging branch as `3aeca80`.

## Closure precondition — noted early

**MEASURED, and it matters:** `gh api repos/Davron2004/Whim/rules/branches/v1-sprint` returns `[]` —
**`v1-sprint` has NO ruleset protection at all.** `main` does (`"Protect main"`: requires PR,
non_fast_forward, deletion, required_status_checks; `ruleset-probe.mjs` exit 0). The harness's
closure design leans on the server-side ruleset as the thing that makes the human gate
UNBYPASSABLE — "no agent path can reach the branch." For this run's target that server-side
guarantee does not exist: a direct push to `v1-sprint` would be accepted by the server.
The gate for this run is therefore procedural, not enforced: the orchestrator opens a PR, stops at
ready-for-review, and `gh pr merge` is denied to every caller by bash-policy. That is weaker than
the `main` lane and the human should decide whether it is acceptable or whether `v1-sprint` should
get a ruleset first. Surfaced rather than silently treated as equivalent.

`scripts/ruleset-probe.mjs` is hardcoded to the repository's DEFAULT branch (`~DEFAULT_BRANCH`
/ `refs/heads/main`); it has no target-branch parameter. This run's PR targets `v1-sprint`, so the
probe does not directly certify the branch being merged into. It is still run at closure as the
standing "no agent path reaches `main`" check, and the actual human gate for this run is unchanged:
`gh pr merge` is denied to every caller, the orchestrator only flips the PR to ready-for-review,
and the human's merge click is the sole ratification act. Divergence surfaced to the human at
closure rather than silently treated as equivalent.

## Chain DAG

- Spine (serial, shares `generation-client.ts` + the new transport module):
  chain-1 → chain-2 → chain-3 → chain-4 → chain-7
- Parallel, file-disjoint from the spine and each other: chain-5, chain-6
- **chain-7 (`on-device-verification`) is ATTENDED-ONLY** per chains.md — needs a main-tree
  `npm run android:release`, a booted emulator, and a running dev server. Not dispatchable.
  Surfaced to the human; skipped by the dispatcher.

## Dispositions

### Round 1 (chain-1, chain-5, chain-6 — dispatched in parallel, file-disjoint)

- `dispatched` chain-1 `launcher-transport-prereqs` — BASE `85525afc1b6ea77c90fbeae5b8b7fd7d45ef9a81`,
  worktree `.claude/worktrees/fgst-chain-1`, branch `chain/fgst-chain-1`.
  Tasks 1.1, 1.2, 1.5 + export `httpErrorFrom`. Writes `handoff/transport-seam.md`.
- `dispatched` chain-5 `server-dev-logging` — BASE `85525afc1b6ea77c90fbeae5b8b7fd7d45ef9a81`,
  worktree `.claude/worktrees/fgst-chain-5`, branch `chain/fgst-chain-5`. Task 4.1. Scope `server/src/`.
- `dispatched` chain-6 `docs-decision-58` — BASE `85525afc1b6ea77c90fbeae5b8b7fd7d45ef9a81`,
  worktree `.claude/worktrees/fgst-chain-6`, branch `chain/fgst-chain-6`. Tasks 5.1, 5.2, 5.3.
  Scope `docs/decisions.md`, `docs/capabilities.md`, `contract/src/index.ts`.
- `report` chain-1 — STATUS complete, GATE PASS (exit 0), commit `ee550c5`, no deviations.
  Task 1.1 RESOLVED: `TextEncoder` **is** guaranteed on the launcher path before generation. Static
  import chain `LauncherRoot.tsx:25` → `version-store/index.ts:16` → `engine.ts:22` → `polyfills.ts:45`
  runs `installHermesPolyfills()` at import time; Hermes also ships `TextEncoder` natively
  (`polyfills.ts:38`) — only `TextDecoder` needed the polyfill. Consequence: chain-2's transport
  module does NOT need to install it itself. This closes design open question 1.
- `integrity` chain-1 exit 0 — changed `handoff/transport-seam.md`, `src/host/launcher/generation-client.ts`.
- `merged` chain-1 + `regate-pass` (gate.sh exit 0). Tasks 1.1, 1.2, 1.5 ticked.
- `report` chain-6 — STATUS complete, GATE PASS (exit 0), commit `c24e67f`. Decision **#58** used,
  tail verified as #57 `eval-harness` before writing. capabilities.md row points at the change-folder
  spec, matching the existing precedent set by the `sdk-charts` and `generation-pipeline` rows for
  capabilities whose change is not yet archived. Two Class-A deviations, both scope-respecting:
  it declined to touch `generation-client.ts`'s doc comment (correctly — that was chain-1's task 1.5),
  and it read the spec's first ~50 lines to confirm the excerpt matched.
- `integrity` chain-6 exit 0 — changed `contract/src/index.ts`, `docs/capabilities.md`, `docs/decisions.md`.
- `merged` chain-6 + `regate-pass` (gate.sh exit 0). Tasks 5.1, 5.2, 5.3 ticked.
- `report` chain-5 — STATUS complete, GATE PASS (exit 0, `server:test` 479 passed), commit `fb963be`.
  **Class-A deviation, accepted, flagged for the reviewer:** it added an optional fourth `onSettled`
  parameter to `buildSseStream` (`server/src/sse.ts`) instead of instrumenting `app.ts` alone. The
  reasoning is sound and is a real trap avoided: a generic Hono `await next()` middleware resolves as
  soon as the route returns its `Response`, i.e. BEFORE a streamed SSE body has drained — logging
  there would have reported a near-zero duration before the pipeline actually ran, which is precisely
  the ambiguity design D5 exists to remove. The middleware therefore skips `text/event-stream` and
  `generate.ts` logs on settle. A `settled` flag makes the callback fire exactly once across all three
  exit paths (normal close, mid-stream error, consumer cancel). Note for review: design §Non-Goals
  says "no change to the server's SSE wire format" — this is an additive optional callback, not a wire
  change, so it reads as compatible, but the reviewer should confirm the "exactly one terminal
  `GenerationEvent` per stream" invariant is untouched.
- `integrity` chain-5 exit 0 — changed `server/src/{app,dev-log,routes/generate,sse}.ts`,
  `server/test/server-core.suite.ts`. No overlap with chain-1 or chain-6: the partition held.
- `merged` chain-5 + `regate-pass` (gate.sh exit 0). Task 4.1 ticked.
- Gate-verdict note: `GATE_EXIT=${PIPESTATUS[0]}` after a `cmd | tail` pipeline returned EMPTY under
  this shell, so the first regate produced a sentinel line but no exit code. Re-run with
  `cmd > file 2>&1; rc=$?` to get a real verdict. Reading `FAST GATE PASSED` off the output is
  exactly the "trust prose over exit codes" failure the runbook warns about; every regate above is
  recorded from a captured `rc`.
### Round 2 (chain-2, spine)

- `dispatched` chain-2 `launcher-xhr-transport` — BASE `b6fe5b95fe6aa8a14310a930070f43d5c90c36b0`
  (staging tip after all three round-1 merges), worktree `.claude/worktrees/fgst-chain-2`,
  branch `chain/fgst-chain-2`. Tasks 2.1–2.6. Reads `handoff/transport-seam.md`.
  Writes `handoff/xhr-transport.md`.
- Round-1 worktrees removed and chain branches deleted UNSANDBOXED (avoids stranding dead
  `.git/config` branch sections that nothing can prune in-session).

- `report` chain-2 — STATUS complete, GATE PASS (exit 0 captured), commit `6bc96de`.
  New module `src/host/launcher/xhr-transport.ts` (231 lines) + a one-line `requestHeaders` export.
  Three Class-A deviations, all accepted:
  1. Exported `requestHeaders` — directed by `handoff/transport-seam.md`, not freelancing.
  2. Chose `createXhr: () => XMLHttpRequest` (defaulting to the global constructor) as the test
     injection seam. Design D2 asked for injectability but left the mechanism open; documented in
     the contract §5 for chain-4.
  3. **Worth the reviewer's attention:** mid-stream network/abort failures are raised as a plain
     `Error` (abort case: an `Error` named `AbortError`) from `reader.read()`, deliberately relying
     on the UNMODIFIED `readNext` to wrap them into `GenerationClientError{kind:'network'}` / the
     `'aborted'` sentinel, rather than classifying inside the transport. This extends the
     "don't reimplement the taxonomy" instruction to its logical end and is consistent with the
     design's highest-value property (nothing below the seam changes). It does mean task 2.5's
     literal wording ("map transport failures to `GenerationClientError{kind:'network'}`") is
     satisfied INDIRECTLY. chain-4's task 3.3 tests `network` on transport failure end-to-end, so
     this is red-checkable rather than taken on faith — chain-4 was told to verify it explicitly.
- `verified` chain-2's self-reported primary-tree slip. The implementer mistakenly applied one Edit
  to the PRIMARY tree's `generation-client.ts` instead of the worktree copy, caught it before
  gating, and reverted. The orchestrator CONFIRMED this independently: `git status --porcelain` in
  the primary tree shows only the orchestrator's own `progress.md`, and HEAD is unmoved. Claim holds.
  **Standing hazard this exposes:** the Edit tool succeeds against either path, so a worktree chain
  editing a file that also exists in the primary tree has a silent failure mode with no error to
  catch it. Only the integrity check and a primary-tree `git status` detect it after the fact.
- `integrity` chain-2 exit 0 — changed `handoff/xhr-transport.md`, `generation-client.ts`,
  `xhr-transport.ts`. Within scope.
- `merged` chain-2 + `regate-pass` (gate.sh exit 0). Tasks 2.1–2.6 ticked.
- Second editor-artifact wave after the chain-5 merge: `server-core.suite.ts` implicit-`any`
  diagnostics on lines 161–260. `npx tsc --noEmit -p server/tsconfig.json` exits 0. Artifact, not a
  defect. Same cause as the first wave — the language server is not using the build's tsconfig.

### Round 3 (chain-3, spine)

- `dispatched` chain-3 `launcher-transport-seam` — BASE `b49c2f0701e39660255ba94cbef79d40294c83c6`.
  Tasks 1.3, 1.4, 2.7.
- `report` chain-3 — STATUS complete, GATE PASS (exit 0 captured; `launcher:test` 1899 checks
  passed), commit `864f834`. One file changed: `generation-client.ts`.
  - **PROBE (design open question 2 settled):** `typeof Response !== 'undefined' && 'body' in
    Response.prototype`, evaluated ONCE at module load. Static feature-detection on the constructor
    prototype — never on an instance from an issued request. The implementer verified this against
    the actual runtime sources rather than assuming: Node's native `fetch` defines a `body` getter
    on `Response.prototype` (`Object.getOwnPropertyDescriptor` confirmed), while `whatwg-fetch`'s
    `Body()` mixin never assigns or defines `body` at all (only `bodyUsed`, `_bodyInit`, `_bodyText`).
    So Node → true, RN → false, with no request issued and no `Platform.OS` branch. That is exactly
    the predicate D1 asked for.
  - **ONE REQUEST:** transport is picked by `opts.streamTransport ?? (fetchCanStream ?
    openFetchGenerateStream : openXhrGenerateStream)` — a `?:` evaluated BEFORE the transport is
    invoked. No await-then-inspect-then-retry path exists to reintroduce the double-billing shape.
  - **TASK 2.7 EVIDENCE (real, not asserted):** diff over the full change range for
    `generation-client.ts`, then grepped the diff for `function readNext`, `function* generateApp`,
    `function parseSseBlock` and each guard (`isGenerationEvent`, `isDiagnostic`, `isUsage`,
    `isWireAppRecord`, `isDeviceIdError`, `isRewriteResponse`) as added/removed lines — ZERO matches.
    Below-the-seam code is provably untouched.
  - **AMBIENT DECL (the question carried from the round-2 note): KEPT, and the reasoning is right.**
    `openFetchGenerateStream` (the renamed former `openGenerateStream`) still calls
    `response.body.getReader()`, and that path is still live — it runs under Node and whenever a
    caller injects `streamTransport`. Since tsconfig excludes the `dom` lib, removing the ambient
    declaration would break the fetch path's typecheck. The declaration was never the bug; the bug
    was DECIDING THE TRANSPORT by inspecting `response.body` on an already-issued request, and that
    check is gone. Question closed.
- `integrity` chain-3 exit 0 — one file, in scope.
- `merged` chain-3 + `regate-pass` (gate.sh exit 0). Tasks 1.3, 1.4, 2.7 ticked.

#### OPEN — flagged for the reviewer at step 11: circular module dependency

chain-3's single Class-A deviation. `generation-client.ts` now imports `openXhrGenerateStream` from
`xhr-transport.ts`, which already imports `requestHeaders`, `httpErrorFrom`, `GenerationClientError`
and `ClientOptions` from `generation-client.ts`. **The cycle is real.** The implementer argues it is
safe because every cross-module reference sits inside a function body (evaluated lazily, after both
modules finish evaluating), the sole top-level const `fetchCanStream` reads only a local primitive,
and typecheck + the esbuild-bundled `launcher:test` + lint + build all pass — verified, not merely
theorized. That argument is sound as far as it goes, and the cycle IS forced by the task: the
module-level default must select the XHR transport, and production (`LauncherRoot.tsx`) injects
neither hook.
It is still a maintainability smell with an obvious clean fix — extract the shared surface
(`requestHeaders`, `httpErrorFrom`, the error/option/reader types) into a third module that both
import, breaking the cycle entirely. Per the repo's standard of preferring long-term
maintainability over development cost, the reviewer is asked to rule on this specifically. If the
reviewer calls for the extraction it becomes a fix chain through steps 5–9, not a main-thread edit.
Note the fast gate cannot catch a cycle-induced TDZ failure, and `guard:metro` is a byte-size
assertion, not a circularity check — so "the gate is green" is NOT evidence the cycle is safe in a
Metro/Hermes bundle. The on-device chain-7 run is what would actually exercise it.

### Round 4 (chain-4, spine tail)

- `dispatched` chain-4 `launcher-transport-tests` — BASE `50667a5af3fd5fff6500a172e4014e210ab868b0`.
  Tasks 3.1–3.7.
- `report` chain-4 — STATUS complete, GATE PASS (exit 0), commit `ad7ee70`. Three new/edited test
  files only; `xhr-transport.ts` and `generation-client.ts` confirmed byte-identical to BASE by the
  orchestrator (`git diff --stat` empty), so the 3.5 red-check revert was total.
  - **RED-CHECK (3.5) actually observed, not asserted.** The implementer made the transport buffer
    until completion and ran the suite: two explicit `✗` failures, then the run stalled and Node
    exited 13 on an unsettled top-level await (a *different* test's bare `await` hung once buffering
    broke it). To get an unambiguous isolated observation it re-ran the negative control alone:
    `✗ the first event resolves without the response ever completing`, exit 1. Then reverted.
  - **TAXONOMY E2E (3.3) holds.** The `network` case is asserted at the level a CALLER observes —
    drive `generateApp`, get the first event, fire `respondError()`, assert `await gen.next()` throws
    `GenerationClientError{kind:'network'}`. So chain-2's indirect two-component classification is
    genuinely verified end to end, not assumed.
  - **EXISTING SUITE (3.7):** `generation-client.suite.ts` untouched, all 12 cases pass unmodified.
    No accommodation needed — the fetch path was not disturbed.
  - **REGISTRATION:** wired into `src/host/launcher/test/acceptance.ts`'s existing discovery.
    `package.json` never touched, so no Class-2 escalation was needed.
- `integrity` chain-4 exit 0 — only the three test files. No throwaway probe leaked into the branch
  (checked `git ls-tree`; every "probe" hit is a pre-existing repo file).
- `merged` chain-4 + `regate-pass` (gate.sh exit 0). Tasks 3.1–3.7 ticked.
- `verified` the suite is genuinely live, not merely imported: `npm run launcher:test` exits 0 with
  **1934 checks passed, 0 failed**, and the new cases appear BY NAME in the output — including
  `negative control: the first event resolves before the stream completes`. Worth checking rather
  than assuming: an editor diagnostic had claimed `runXhrTransportTests` was "declared but never
  read", which would have meant dead registration. It was another artifact.

### ADJUDICATED — Class B: surrogate-pair corruption in the XHR transport (DECISION: FIX)

chain-4 reported a **reproduced, spec-violating correctness bug**, distinct from anything the design
anticipated. This is the most valuable finding of the run and it came from the chain whose whole
purpose was to test the blindness rather than the bug.

**The defect.** `xhr-transport.ts`'s `newTextChunk` slices the accumulated `responseText` by
character offset and `TextEncoder.encode()`s each slice INDEPENDENTLY. If a delivery boundary lands
exactly between the two UTF-16 surrogate halves of an astral character (emoji, CJK ext-B+), each
half is encoded alone; per the WHATWG encoding spec a lone surrogate encodes to the replacement
sequence `EF BF BD`. Both halves corrupt independently and `generateApp`'s downstream full-redecode
cannot recover the lost code points. Verified empirically by driving the REAL
`openXhrGenerateStream` + `generateApp` pipeline with a fake XHR splitting mid-pair — observed
`"text":"hello <2x replacement char> world"` instead of the emoji.

**Why the design missed it.** §D3's mitigation reasoned that slicing the *accumulated*
`responseText` rather than per-chunk deltas means "any split is healed by the accumulation." That is
true at the BYTE level but the slicing happens at the UTF-16 CODE-UNIT level, and the corruption is
introduced by the per-slice `encode()` BEFORE accumulation can heal anything. The mitigation is
sound for every multi-byte character in the BMP (provably unsplittable via string slicing, since
they are single code units) and unsound for exactly the astral range. Refines decision #58.

**Adjudication.** chain-4 offered (a) accept as residual risk pending the on-device check, matching
the design's own framing, or (b) fix it with surrogate-boundary buffering. **Ruling: (b), fix.**
Reasons: the spec requirement says without qualification "Multi-byte UTF-8 characters split across
delivery boundaries SHALL decode correctly", so shipping (a) means knowingly shipping a spec
violation, not carrying an unknown; the failure is SILENT data corruption in user-visible strings
(mini-app names, tokens, diagnostics); the bug is already REPRODUCED, which is the repo's stated bar
for fixing rather than deferring; and the fix is small, standard, and self-contained — hold a
trailing lone high surrogate back until its pairing code unit arrives, which is simply what a
correct stateful decoder does. Deferring to the on-device check would also be the wrong instrument:
the device can only tell us whether Android's native layer HAPPENS to split there, not whether the
transport handles it when it does.
**Bonus the fix unlocks:** chain-4 could not commit a mid-surrogate test (it would have been a
permanently-red test, and bending the test to match the implementation was explicitly barred). Once
the transport buffers correctly that test becomes committable — so the fix converts an
unverifiable risk note into a real red-checkable regression guard.

Dispatched as **chain-8** through the normal steps 5–9. NOT a main-thread edit.

### Round 5 (chain-8, the adjudicated fix)

- `dispatched` chain-8 `surrogate-boundary-fix` — BASE `e5df7abefd2b5ab8da99f649a5864fa931eff05e`.
- `report` chain-8 — STATUS complete, GATE PASS (exit 0), commit `02f14c9`, **no deviations**.
  - **FIX:** in `newTextChunk`, when `!done` and the slice is non-empty, check only
    `slice.charCodeAt(slice.length - 1)`. If it is in `0xD800`–`0xDBFF` (unpaired high surrogate),
    trim it from the slice and set `consumedThrough = text.length - 1` rather than `text.length`.
    The held-back unit is never removed from `text`, only from what `offset` marks consumed — so the
    next call's `text.slice(offset)` begins with exactly that unit. No duplication (it is sliced out
    of this chunk, not copied) and no drop (offset never advances past it). Only the LAST code unit
    can be an unpaired high surrogate, because `responseText` is contiguous, so this is a
    single-code-unit check, not a scan. A low surrogate can never be stranded for the same reason.
  - **STREAM END:** at `done === true` the check is skipped entirely, so a genuinely truncated body
    ending in a lone high surrogate encodes it as-is (one replacement sequence) and still delivers
    the chunk with `done: true`. The reader always terminates — it cannot hang, and it does not
    silently swallow the trailing unit. Correct call: the body was already malformed on the wire.
  - **RED-CHECK (8.3) OBSERVED.** With the fix stashed and the new test kept:
    `✗ reassembles the astral character intact even when split mid-surrogate-pair
    (got "hello <2x replacement char> world", want "hello 🎉 world")` and
    `✗ no replacement character appears anywhere in the decoded event` — `1935 passed, 2 failed`.
    Fix restored, suite back to green. The new test is a real guard, not a comment.
  - **SUITE:** `1937 checks passed, 0 failed`, up from 1934 by exactly the 3 new assertions. Every
    chain-4 case still passes unchanged — multi-byte-adjacent, negative control, abort, the four
    taxonomy cases, and exactly-one-request. `fake-xhr.ts` needed no change: `respondIncremental`
    already splits `responseText` at any character index, mid-pair included.
- `integrity` chain-8 exit 0 — two files, in scope. No stash residue and no red-check scratch files
  tracked on the branch (checked `git ls-tree` for `redcheck`/`probe-src`).
- `merged` chain-8 + `regate-pass` (gate.sh exit 0).

### Step 10 — FULL GATE on the merged staging tip

`./scripts/gate-full.sh` **exit 0 — FULL GATE PASSED.** Covers what the fast gate does not: knip,
`guard:metro`, the three Chromium sandbox-isolation invariant suites, and `openspec validate`
(33 items, 0 failed). Note this is also the first check that would have caught a knip "unused module"
complaint about `xhr-transport.ts`, which chain-2 correctly flagged as invisible to its own self-gate.

### Step 11 — REVIEWER: **APPROVE WITH FOLLOW-UPS**

Read-only audit of `26d6fd5..3d75ec1` (the whole change). **No high or medium findings.
No report mismatch.** All six spec requirements met.

**The circular import, settled properly.** The reviewer did not accept the implementer's
"all references are inside function bodies" argument on its face — it compiled both real files
through the project's actual `@react-native/babel-preset` and read the emitted CommonJS.
Babel hoists function-declaration exports ABOVE the `require()` call, so the re-entrant require
sees `httpErrorFrom`/`requestHeaders` already populated, while `GenerationClientError` (a class,
initially a `void 0` placeholder) is not read until `openXhrGenerateStream` actually runs — by
which point A has finished executing and reassigned the live binding on the shared `exports`
object. **Safe today, proven by compilation rather than by reasoning.**
It also independently confirmed against `XMLHttpRequest.js:558` that RN's incremental-delivery gate
requires setting `.onreadystatechange`/`.onprogress` as PROPERTIES (not `addEventListener`), which
is what the transport does — so the compiled-output check was against the real mechanism.

**Ledger claims independently re-executed and reproduced** (this is the check on agent self-reports):
`launcher:test` 1937/0 including every named test string, `server:test` 479/0, `tsc --noEmit` exit 0,
`openspec validate` valid, `generation-client.suite.ts` genuinely absent from the diff,
`package.json` genuinely untouched, chain-7's tasks correctly left unchecked. Nothing overstated.

**Findings (all low):**
1. The cycle is safe but the invariant it depends on ("no top-level cross-module read") is
   **enforced by no tool in the gate** — lint won't flag it, tsc doesn't care, and esbuild's
   bundling order differs from Metro's so the Node suite structurally cannot validate it. One
   future top-level line silently reintroduces a device-only TDZ failure with every check green.
2. `fetchCanStream`'s probe would throw if a runtime defined `Response` with an `undefined`
   `.prototype`. Unreachable in both real target runtimes; a throw during module evaluation is
   nevertheless the worst place for one.
3. An abort landing in the microtask window between `finished = true` and `httpErrorFrom().then()`
   resolving is silently dropped — the caller sees the classified `http`/`device_id` error instead
   of `'aborted'`. Non-crashing; a semantic nit, not a functional break.
4. (informational, not a defect) the `declare global` `Body.body` declaration is legitimate — the
   fetch path is genuinely live and reachable. Confirms the round-3 ruling.

**Dispatcher decision: act on all three now, as chain-9, rather than tracking them.**
The reviewer explicitly would not BLOCK the PR on finding 1 — but its own reasoning is the argument
for doing it: the failure mode it describes (green gates, device-only breakage) is precisely the
failure class this entire change exists to eliminate, and the cycle did not exist before this
change introduced it in chain-3. Removing it is repairing our own work, not scope creep. Findings 2
and 3 are cheap and in the same files. Per the repo's standing instruction to weight long-term
maintainability over development cost, "tracked as a near-term follow-up" is the outcome that
reliably becomes "never".

### Round 6 (chain-9, reviewer follow-ups)

- `dispatched` chain-9 — BASE `3d75ec1a48efc2bae03200cd625fd8f7e90939b5`. Tasks 9.1 (extract
  `requestHeaders`, `httpErrorFrom`, `GenerationClientError`, `GenerationClientErrorKind`,
  `ClientOptions`, `ResponseBodyReader` into a third module so the cycle disappears — a PURE MOVE,
  no logic changes), 9.2 (null-guard the probe), 9.3 (the abort race — the implementer is explicitly
  empowered to DECLINE if closing it would contort the terminal-path logic or endanger the
  idempotent single-fire guarantee; a clean decline was stated as a better outcome than a fragile
  fix). Told to run the FULL gate itself, since a new extracted module is exactly what knip and
  `guard:metro` exist to catch and the fast gate runs neither.

- `report` chain-9 — STATUS complete, fast gate exit 0, commit `00623a4`.
  - **9.1 CYCLE BROKEN.** New `src/host/launcher/transport-shared.ts` (123 lines). Final graph,
    independently verified by the orchestrator by grepping every import line:
    `transport-shared.ts` → `@whim/contract` ONLY (type-only);
    `generation-client.ts` → `xhr-transport.ts` + `transport-shared.ts`;
    `xhr-transport.ts` → `transport-shared.ts` only. **`xhr-transport.ts` no longer imports
    `generation-client.ts` at all.** One direction, no cycle.
  - Class-A deviation, correct: the move had to include `httpErrorFrom`'s dependency chain
    (`isDeviceIdError`, `isRecord`, `isNonEmptyString`) beyond the reviewer's literal six symbols —
    otherwise `httpErrorFrom` would still import from `generation-client.ts` and the cycle would
    survive the "fix". `generation-client.ts` imports `isRecord`/`isNonEmptyString` back for its own
    remaining guards rather than duplicating them.
  - Class-A deviation, also correct: re-exported only `GenerationClientError` and `ClientOptions`
    from `generation-client.ts` (grepped: `LauncherRoot.tsx` and both acceptance suites import those
    by that path). `requestHeaders`, `httpErrorFrom`, `GenerationClientErrorKind` had no outside
    importer, so re-exporting them would have been dead public surface and a knip risk.
  - **AMBIENT DECL:** the whole `declare global` block moved into `transport-shared.ts` with
    `ResponseBodyReader`. Verified safe by establishing where the globals actually come from —
    `tsc --listFiles` shows neither `lib.dom` nor `@types/node` is loaded, so `Response`/`Body`/
    `fetch`/`XMLHttpRequest` come from RN's own `globals.d.ts`, whose `Body` has no `.body`, which
    is exactly the gap this augmentation fills. Global augmentation merges program-wide based on
    compilation membership, NOT on import edges, so `openFetchGenerateStream` still typechecks.
  - **9.2:** added `Response.prototype !== undefined &&` so the probe short-circuits to `false`
    instead of throwing `TypeError: Cannot use 'in' operator`. Declined to add a test, with a
    reason I accept: faking "Response defined but `.prototype` undefined" means monkey-patching the
    real ambient global, and the suite runner bundles every suite into one process/module graph, so
    it would risk bleeding into unrelated suites. The actual behavioral guarantee (true under Node,
    false under a whatwg-fetch shape) is already covered end to end.
  - **9.3: MADE the change** (it was offered a clean decline and judged the fix safe).
    `finishHttpError` re-checks `signal?.aborted` inside the `httpErrorFrom(...).then(...)`
    continuation and resolves `'aborted'` rather than rejecting with the classified error. One added
    branch at the single settle point; `finished`/`opened` still get exactly one write each, so the
    idempotent single-fire guarantee is untouched. **Red-checked:** with the fix reverted the new
    test failed `THREW: GenerationClientError: boom` (1937 passed / 1 failed); restored → 1939/0.
  - **`guard:metro` failed in the worktree — correctly diagnosed as NOT a regression.** The
    implementer verified by `git stash --include-untracked` to a clean checkout that the identical
    failure ("Unable to resolve module @babel/runtime/helpers/interopRequireDefault") reproduces
    with zero diff applied. This matches the standing constraint that `guard:metro` only works from
    the main tree. Exactly the right instinct: it did not report a green it had not earned, and it
    did not assume the failure was its own.
- `integrity` chain-9 exit 0 — four files, in scope.
- `merged` chain-9 + `regate-pass` (gate.sh exit 0).

### Step 10 (re-run) — AUTHORITATIVE FULL GATE on the final tip, from the PRIMARY TREE

`./scripts/gate-full.sh` **exit 0 — FULL GATE PASSED**, including the `guard:metro` check the
worktree structurally cannot run. knip clean, `openspec validate` 33/33, storage 205, bridge 91,
invariants 112, **launcher 1939 checks passed / 0 failed**.

### Step 12 — CLOSURE

- `ruleset-probe` exit 0 ("Protect main": requires PR, non_fast_forward, deletion,
  required_status_checks). See the closure-precondition note above for why this does NOT certify
  `v1-sprint`, which is the branch this run actually targets.
- `push` `integration/fix-generate-stream-transport` → origin.
- `pr` **#19** opened as a DRAFT into **`v1-sprint`** (per the human's base override), not `main`.
- `poll` — **SETTLED PASS, verdict exit 0** after 5 polls: `SonarCloud Code Analysis` pass,
  `isolation-suite` pass, `quality-gate` pass. Classified by
  `scripts/fixloop.sh checkverdict`, not read off the output; both `gh` and the predicate ran in the
  same unsandboxed context so the predicate could actually see the file.

#### Sonar round 1

`node scripts/sonar-pr-issues.mjs --pr 19` **exit 0 (gate OK)** with 5 open MINOR issues →
`findings-sonar-1.md`. Gate-green, so strictly optional — fixed anyway, because the human asked for
a Sonar check and the repo standard is to fix what you find.

- **S1 `xhr-transport.ts:138` `typescript:S7758`** — "prefer `codePointAt` over `charCodeAt`".
  **Resolved as a deliberate suppression, not a compliance edit.** That line IS chain-8's
  surrogate-boundary guard: it must read a single UTF-16 CODE UNIT to detect an unpaired trailing
  high surrogate, which is precisely the abstraction `codePointAt` (a code-POINT API) exists to hide.
  The two are numerically identical at this exact site — the read is always the slice's last index,
  so there is never a following unit to combine with — but adopting `codePointAt` would signal
  code-point semantics to a future reader and invite a "simplification" that silently breaks the
  guard. Kept `charCodeAt` with `// NOSONAR` plus explanatory prose above.
  The fix-worker FOUND the repo's existing convention rather than inventing one: trailing
  `// NOSONAR` on the flagged line with the "why" immediately above, per
  `src/runtime/web/syscall.js:47` and `src/sdk/navigation.tsx:116`. No rule-ID-scoped convention
  exists here.
- **S2 `server-core.suite.ts:657` `S7770`** — `args.map((a) => String(a))` → `args.map(String)`.
  Safe: `String` takes one argument, so `map`'s extra `(index, array)` are ignored.
- **S3/S4/S5 `:668/:681/:701` `S6594`** — `.match(RE)` → `RE.exec(...)`. Verified safe rather than
  assumed: `LOG_LINE_RE` has **no `/g` flag**, so `exec` carries no `lastIndex` state across calls,
  and each site is a one-shot check rather than a loop. No behavior change.
- `integrity` exit 0 (two files). `merged` + `regate-pass` (gate.sh exit 0).
  Suites held exactly at baseline: launcher 1939/0, server 479/0.
- `push` round-1 fixes → `057f461..8245408`.

#### Sonar round 2 — GREEN

`node scripts/sonar-pr-issues.mjs --pr 19` exit 0, **gate OK, issues: 0**.

#### History cleanup

`/git-cleanup` with `target_branch=integration/fix-generate-stream-transport`.
**CLEANUP GATE PASS** — tip tree identical to the pinned `5a51c780…`, target unmoved, backup intact.
**28 commits → 5**, a strict file partition with no straddling:

| commit | scope |
|---|---|
| `docs(openspec): plan … and record its build ledger` | the whole change folder |
| `fix(launcher): stream generate over XMLHttpRequest when fetch has no response body` | `transport-shared.ts`, `xhr-transport.ts`, `generation-client.ts` |
| `test(launcher): cover the XHR generate transport against a fake XMLHttpRequest` | `fake-xhr.ts`, `xhr-transport.suite.ts`, `acceptance.ts` |
| `feat(server): log every dev request and stream lifecycle event …` | `server/src/*`, `server/test/server-core.suite.ts` |
| `docs: record decision 58 on the RN generate stream transport` | `decisions.md`, `capabilities.md`, `contract/src/index.ts` |

All three fix commits FOLDED, none standalone: the Sonar round (`ad89034`), the surrogate fix
(`02f14c9`) and the cycle break (`00623a4`) were each split by file into the semantic commits that
own those files. Nine chain-merge commits and six ledger-tick commits absorbed.
The cleaner built each index BY FILE (`read-tree --prefix` / `update-index --cacheinfo`) rather than
by chronological snapshot, because chains 5 and 6 landed between launcher chains 1 and 2 — a
snapshot-boundary partition would have forced launcher/server/docs work to interleave. Index-only
throughout; no `reset --hard`, no `checkout --`, no `read-tree -u`, no working-tree write.

- `apply` orchestrator ref move + `git push --force-with-lease` → `8245408…acc62b8`.
  Tree verified identical after the reset (`5a51c780…`) with ZERO file churn, as designed.
- `teardown` grant, owners marker, lane worktree and cleanup branch removed.
  **`backup/pre-cleanup-integration-fix-generate-stream-transport` RETAINED** as the rollback until
  the human merges — `git reset --hard backup/pre-cleanup-integration-fix-generate-stream-transport`.
- `ancestry` `git merge-base --is-ancestor v1-sprint integration/…` → YES, no divergence.
- `poll` on the REWRITTEN SHAs — **SETTLED PASS** (verdict exit 0), all three checks. Sonar re-checked:
  gate OK, 0 issues.
- `ready` PR #19 flipped out of draft. `gh pr merge` is denied to every caller; the human's merge
  click is the sole ratification act.

### Closing summary

**Chains run: 7 of 8.** chain-1, chain-2, chain-3, chain-4 (spine) + chain-5, chain-6 (parallel),
plus two chains that did not exist when the run started: chain-8 (adjudicated defect fix) and
chain-9 (reviewer follow-ups). Plus one Sonar fix round.
**chain-7 (on-device) NOT run — attended-only, and it is the change's one real gap.**

**Redispatches: 0.** Every chain came back complete and green on its first dispatch. No chain was
parked, no merge conflicted, so the chains.md partition was correct as planned.

**Deviations by class:** Class A ×9, all accepted, three of them genuinely load-bearing (chain-5's
`onSettled` threading, chain-2's decision not to reimplement the taxonomy, chain-9's widening of the
extraction to `httpErrorFrom`'s dependency chain — without which the "fix" would have left the cycle
intact). **Class B ×1**, adjudicated to FIX: the surrogate-pair corruption. **Class C: none.**
No Class-2 escalation was needed — `package.json` was never touched, which chain-4 had flagged as a
live possibility for suite registration.

**Reviewer verdict:** APPROVE WITH FOLLOW-UPS. No high or medium findings, no report mismatch, all
six spec requirements met. The three low findings were all actioned in chain-9 rather than tracked.

**Two defects found and fixed that were NOT in the proposal**, both by the machinery rather than by
inspection:
1. The surrogate-pair corruption — found by the acceptance chain, which is exactly what design §D4
   ("test the blindness, not just the bug") predicted would be worth building.
2. The module cycle — found by the reviewer, introduced by this change's own seam wiring.

**Final state:** `gate-full.sh` exit 0 from the primary tree; launcher 1899 → **1939** checks;
server 479; SonarCloud gate OK with 0 issues; PR #19 ready for review into `v1-sprint`.

**Memories persisted:** a new `whim-node-suite-bare-await-hang` (a bare `await` in these suites
converts a regression into a whole-suite hang at exit 13 with no test named), and two additions to
the existing `whim-worktree-module-resolution` (the `metro-guard`-in-worktree corollary with the
stash-and-rerun verification technique, and the Edit-tool worktree-vs-primary-path hazard that
nearly cost a silent mis-edit here).

**Not carried out, flagged for the human:** the cleaner observed that `progress.md` is 453 lines and
is a build-loop diary rather than a spec artifact — worth trimming before archive. It correctly did
not act, since that is a content change and the cleanup lane forbids one.

### Investigated and dismissed — editor-only diagnostic

After the chain-1 merge the IDE reported `generation-client.ts:155` "Property 'body' must be of type
`ReadableStream<Uint8Array<ArrayBuffer>> | null`" against the file's `declare global` augmentation,
plus a cascade of "Cannot find module" errors in `server/**` and `contract/**`.
**Both are artifacts, not defects.** `npx tsc --noEmit -p tsconfig.json` exits 0 with ZERO output on
the merged tip. The `body` conflict only arises when `lib.dom` is in scope, which this project's
tsconfig deliberately excludes (React Native is not a DOM runtime); the language server is resolving
with DOM libs the build never uses. The module cascade is the editor still pointing at the three
round-1 worktrees that were just removed. Recorded so neither the reviewer nor a later session
re-investigates.
**One genuine question left for the reviewer:** the ambient `declare global` block still DECLARES a
`body` on `Response`. Chain-1's task 1.5 corrected the prose claim; whether the type declaration
itself should survive once chain-3 stops inspecting `response.body` is a real question, and it is
the same class of hazard as the original bug — an ambient type asserting a capability the runtime
does not have is exactly what let `response.body` go unchallenged.

- Worktree note: a fresh worktree has no `node_modules` (they are gitignored and not linked by
  `git worktree add`), so the orchestrator symlinks the primary tree's `node_modules` into each
  worktree before `npm run build`. Without it the build and self-gate cannot resolve anything.

