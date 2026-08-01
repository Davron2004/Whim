# Progress ledger — fix-generate-stream-transport

Outcome record. Per-chain dispatch bookkeeping (worktree SHAs, merge/regate lines, editor-diagnostic
investigations) was trimmed at closure — it was build-loop diary, not a spec artifact. What remains is
what a later reader needs: what was decided, what was found that the proposal did not anticipate, and
what the device actually showed.

## Run parameters

- `run-start` 2026-07-31 — schema `whim-harness`, dispatch loop.
- **Base override (human instruction):** branched from `v1-sprint`, not `main`.
  `V1_SPRINT_TIP = 26d6fd545c5452242000f12d4580c8ee17b5897e`. Closure opens its PR into `v1-sprint`.
- Chains: spine `chain-1 → chain-2 → chain-3 → chain-4`, parallel file-disjoint `chain-5`, `chain-6`,
  attended-only `chain-7`. Two chains created mid-run: `chain-8` (adjudicated defect) and `chain-9`
  (reviewer follow-ups). **Redispatches 0, parks 0, merge conflicts 0** — the chains.md partition held.

## Closure precondition — `v1-sprint` has no ruleset

**MEASURED:** `gh api repos/Davron2004/Whim/rules/branches/v1-sprint` returns `[]`. `main` has
`"Protect main"` (requires PR, non_fast_forward, deletion, required_status_checks). The harness's
closure design leans on the server-side ruleset as what makes the human gate UNBYPASSABLE. For this
run's target that guarantee does not exist: a direct push to `v1-sprint` would be accepted.
The gate here is therefore **procedural, not enforced** — the orchestrator opens a PR and stops, and
`gh pr merge` is denied by bash-policy. Weaker than the `main` lane.
`scripts/ruleset-probe.mjs` is hardcoded to the repo's DEFAULT branch and has no target-branch
parameter, so it does not certify the branch actually being merged into.
**Human decision 2026-08-01: leave `v1-sprint` unprotected for now.** Recorded so the gap is a choice
rather than an oversight.

## Resolved open questions

- **`TextEncoder` availability (design Q1).** Guaranteed on the launcher path before generation.
  Static import chain `LauncherRoot.tsx:25` → `version-store/index.ts:16` → `engine.ts:22` →
  `polyfills.ts:45` runs `installHermesPolyfills()` at import time, and Hermes ships `TextEncoder`
  natively — only `TextDecoder` needed the polyfill. The transport does not install it itself.
- **Transport selection predicate (design Q2).** `typeof Response !== 'undefined' &&
  Response.prototype !== undefined && 'body' in Response.prototype`, evaluated ONCE at module load —
  static feature-detection on the constructor prototype, never on an instance from an issued request.
  Verified against real runtime sources: Node's native `fetch` defines a `body` getter on
  `Response.prototype`; `whatwg-fetch`'s `Body()` mixin never defines `body` at all (only `bodyUsed`,
  `_bodyInit`, `_bodyText`). Node → true, RN → false, with no request issued and no `Platform.OS`
  branch. Selection is a `?:` evaluated BEFORE the transport is invoked, so no await-then-inspect-then-
  retry path exists to reintroduce double-billing.
- **RN's incremental-delivery gate.** Confirmed against `XMLHttpRequest.js:558`: RN enables incremental
  events only when `.onreadystatechange`/`.onprogress` are set as PROPERTIES, not via
  `addEventListener`. The transport sets properties.
- **The ambient `declare global` `Body.body` declaration is legitimate and was kept.** `tsc --listFiles`
  shows neither `lib.dom` nor `@types/node` is loaded, so `Response`/`Body`/`fetch`/`XMLHttpRequest`
  come from RN's own `globals.d.ts`, whose `Body` has no `.body` — exactly the gap the augmentation
  fills. The declaration was never the bug; the bug was DECIDING THE TRANSPORT by inspecting
  `response.body` on an already-issued request, and that check is gone.

## Two defects found that were NOT in the proposal

Both surfaced by the machinery rather than by inspection. These are the run's durable findings.

### 1. Surrogate-pair corruption in the XHR transport (Class B — adjudicated FIX, chain-8)

`newTextChunk` sliced the accumulated `responseText` by character offset and `TextEncoder.encode()`d
each slice INDEPENDENTLY. If a delivery boundary lands exactly between the two UTF-16 surrogate halves
of an astral character, each half encodes alone, and per the WHATWG encoding spec a lone surrogate
encodes to the replacement sequence `EF BF BD`. Both halves corrupt independently and `generateApp`'s
downstream full re-decode cannot recover the lost code points. Reproduced end to end by driving the
REAL `openXhrGenerateStream` + `generateApp` pipeline with a fake XHR splitting mid-pair:
`hello 🎉 world` → `hello <2x replacement char> world`.

**Why the design missed it.** §D3 reasoned that slicing the *accumulated* `responseText` rather than
per-chunk deltas means "any split is healed by the accumulation." True at the BYTE level — but the
slicing happens at the UTF-16 CODE-UNIT level, and the corruption is introduced by the per-slice
`encode()` BEFORE accumulation can heal anything. The mitigation is sound for every multi-byte
character in the BMP (single code units, provably unsplittable by string slicing) and unsound for
exactly the astral range. **Refines decision #58.**

**Fix.** When `!done` and the slice is non-empty, check `slice.charCodeAt(slice.length - 1)`; if it is
in `0xD800`–`0xDBFF` (unpaired high surrogate), trim it and set `consumedThrough = text.length - 1`.
The held-back unit is never removed from `text`, only from what `offset` marks consumed, so the next
call's `text.slice(offset)` begins with exactly that unit — no duplication, no drop. Only the LAST code
unit can be an unpaired high surrogate (`responseText` is contiguous), so this is a single-unit check,
not a scan. At `done === true` the check is skipped, so a genuinely truncated body still terminates.
Red-checked: with the fix stashed, `1935 passed / 2 failed`; restored, green.

### 2. A module cycle introduced by this change's own seam wiring (reviewer finding, chain-9)

chain-3 made `generation-client.ts` import `openXhrGenerateStream` from `xhr-transport.ts`, which
already imported `requestHeaders`/`httpErrorFrom`/`GenerationClientError`/`ClientOptions` back from
`generation-client.ts`. The reviewer proved the cycle *safe today* by compiling both real files through
the project's actual `@react-native/babel-preset` and reading the emitted CommonJS — Babel hoists
function-declaration exports above the `require()`, so the re-entrant require sees them populated,
while the class binding is not read until the transport actually runs. **Safe by compilation, not by
reasoning.**

Fixed anyway, and the reason is the point: the invariant it depends on ("no top-level cross-module
read") is **enforced by no tool in the gate** — lint won't flag it, tsc doesn't care, `guard:metro` is a
byte-size assertion, and esbuild's bundling order differs from Metro's so the Node suite structurally
cannot validate it. One future top-level line would silently reintroduce a device-only TDZ failure with
every check green. That is precisely the failure class this change exists to eliminate.

**Fix.** Extracted the shared surface into `src/host/launcher/transport-shared.ts`. Final graph:
`transport-shared.ts` → `@whim/contract` only (type-only); `generation-client.ts` → `xhr-transport.ts`
+ `transport-shared.ts`; `xhr-transport.ts` → `transport-shared.ts` only. One direction, no cycle.
The move had to include `httpErrorFrom`'s dependency chain (`isDeviceIdError`, `isRecord`,
`isNonEmptyString`) beyond the reviewer's literal six symbols — otherwise the cycle would have survived
the "fix".

## Reviewer verdict — APPROVE WITH FOLLOW-UPS

Read-only audit of `26d6fd5..3d75ec1`. **No high or medium findings. No report mismatch.** All six spec
requirements met. Ledger claims independently re-executed and reproduced rather than taken on trust.
Three low findings, **all actioned in chain-9** rather than tracked: the unguarded cycle invariant
(above), a `Response.prototype`-undefined throw in the probe (null-guarded), and an abort landing in the
microtask window between `finished = true` and `httpErrorFrom().then()` resolving being silently
dropped (`finishHttpError` now re-checks `signal?.aborted` in the continuation; red-checked).

**Deviations:** Class A ×9, all accepted — three load-bearing (chain-5's `onSettled` threading, chain-2's
decision not to reimplement the error taxonomy, chain-9's widening of the extraction). **Class B ×1**,
adjudicated to FIX. **Class C: none.** No Class-2 escalation was needed — `package.json` was never
touched.

One deviation worth keeping visible: chain-5 added an optional fourth `onSettled` parameter to
`buildSseStream` instead of instrumenting `app.ts` alone, because a generic Hono `await next()`
middleware resolves as soon as the route returns its `Response` — i.e. BEFORE a streamed SSE body has
drained — which would have logged a near-zero duration before the pipeline ran. That is exactly the
ambiguity design D5 exists to remove.

## chain-7 — ON-DEVICE VERIFICATION: **PASS** (attended, 2026-08-01)

Run on `emulator-5554` (`sdk_gphone64_arm64`, Android 16) against `npm run server:dev` on the **real**
OpenRouter pipeline (not the stub), reached via `adb reverse tcp:8787`. APK from
`./gradlew assembleRelease`, verified to be this branch's build rather than a stale bundle: the Hermes
bytecode string table contains `The generate request timed out` / `was aborted` / `failed`, three
literals that exist nowhere but `xhr-transport.ts`.

- **6.1 PASS.** Real generation end to end. `POST /v1/rewrite 200 9059ms`, then
  `POST /v1/generate 200 155815ms`. The app installed and appears on the home grid.
- **6.2 PASS — and this is the claim no Node fake could settle.** Stage subtitle read "Planning" at
  t=48s and "Writing the code" from t=56s, while the request stayed open until t=206s. **The UI
  advanced ~150 seconds before the response completed.** Timeline extracted by cropping the subtitle
  band out of 1-second screen captures and hashing it, so the transition time is measured, not eyeballed.
- **6.3 PASS.** Generated a mood tracker whose source contains four astral-plane emoji (U+1F60x) and
  Cyrillic. All rendered intact in the sandboxed mini-app — **zero replacement characters**. Note the
  precise scope: this confirms the ordinary path is correct on the real native decoder; it does not
  prove Android split mid-pair on this run. The mid-surrogate guard itself is covered by the committed
  red-checked unit test, which is the right instrument for that.
- **6.4 PASS.** Cancelled mid-stream during "Writing the code". The UI returned cleanly to the prompt
  screen with the text preserved — no error screen, no crash — and **no app was installed** (home grid
  unchanged at four tiles). The abort genuinely reached the server rather than merely stopping the UI:
  that request logged `POST /v1/generate 200 24845ms`, matching the 25s between the Build tap
  (10:22:06) and the Cancel tap (10:22:31), against 155815ms for the run allowed to finish.
- **6.5 PASS — incremental delivery DOES fire on RN 0.85.3 Android.** It does not coalesce. Reported
  affirmatively per the task's requirement to state the answer either way. Settles design open
  question 3 and design risk 2.

Also verified live on-device: **task 4.1's dev logging works** — every request logged with method,
path, status and duration, and the duration is the honest settle time (the 24845ms abort proves the
`onSettled` threading, not middleware timing). No JS errors and no native crashes in logcat across both
runs. The one `[whim:page] REJECTED-FORGERY kind=spoof-probe` line is the sandbox's nonce-authentication
negative control firing correctly (spike2 finding F4), not a fault.

## Final state

- `gate-full.sh` **exit 0 from the primary tree** — knip clean, `guard:metro` (which a worktree
  structurally cannot run), `openspec validate` 33/33, storage 205, bridge 91, invariants 112.
- **launcher 1899 → 1939 checks**, 0 failed. server 479, 0 failed.
- SonarCloud: two rounds, ended **gate OK, 0 issues**. Round 1's five MINOR issues were fixed though
  the gate was already green. One was resolved as a deliberate `// NOSONAR` suppression rather than a
  compliance edit: `xhr-transport.ts:138` is chain-8's surrogate guard and must read a single UTF-16
  CODE UNIT, which is precisely the abstraction `codePointAt` exists to hide — adopting it would signal
  code-point semantics to a future reader and invite a "simplification" that silently breaks the guard.
- History cleaned: **28 commits → 5 semantic + 1 ledger**, tip tree byte-identical to the pinned target.
  All three fix commits folded by file into the semantic commits that own those files.
- PR **#19** into `v1-sprint`, checks green, mergeable. The human's merge click is the sole
  ratification act.

**Memories persisted:** `whim-node-suite-bare-await-hang` (a bare `await` in these suites converts a
regression into a whole-suite hang at exit 13 with no test named), plus two additions to
`whim-worktree-module-resolution` (the `guard:metro`-in-worktree corollary with its stash-and-rerun
verification technique, and the Edit-tool worktree-vs-primary-path hazard — the Edit tool succeeds
against either path, so a worktree chain editing a file that also exists in the primary tree has a
silent failure mode that only the integrity check and a primary-tree `git status` can detect).
