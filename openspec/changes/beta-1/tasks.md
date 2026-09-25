## 1. Wire protocol that can grow (contract, request edge, device decoder)

- [x] 1.1 Contract: export `PROTOCOL_LEVEL = 1`, the `compat` envelope schema (`min`, `fallback` ∈ skip|fail|update, `notice` ≤ 200 chars), a permissive `WireEnvelope` (type/error string + optional compat, unknown fields tolerated), the `queued{position}` and `restart` events, the clarify `limit{reason, alternative}` arm (a `limit` with non-empty `questions` is rejected), `select` ∈ one|many and `other` on `ClarifyQuestion`, `Clarification` as `{id, question, choices, other? (1–200 chars), decide?}` (decide alone, or at least one choice or `other`; at most one choice for `select: 'one'` is enforced by the device and server), `compat` on `ApiError`, and the `queue_timeout` terminal failure code. Every object schema strips unknown fields rather than rejecting them. Contract tests for every `generation-contract` scenario (design D16).
- [x] 1.2 Server request edge: parse `x-whim-protocol` beside the request envelope. Missing or non-integer → `426 update_required` through the existing update-gate response. Expose the level on the request context. Add a server-side registry of messages/codes with the level each was introduced at, plus an emitter helper that attaches `compat` to anything above level 1 and refuses to send above the client's level. Test: every registry entry above level 1 carries `compat`, and a level-N client never receives a level-N+1 message.
- [x] 1.3 Device: send `x-whim-protocol: PROTOCOL_LEVEL` on every `/v1` request. Decode every SSE frame and unary body in two phases (envelope first, full schema only for known types/codes with `min ≤ PROTOCOL_LEVEL`). Surface a typed fallback outcome (`skip` → continue, `fail{notice}`, `update{notice}`) to callers; the UI wiring is 4.4. Replace the "unknown type throws `stream_parse`" path and the closed-refusal-code lookup accordingly.
- [x] 1.4 "Future frames" fixture suite on the device decoder: an unknown event with each fallback, an unknown event with no `compat` (→ fail), an unknown fallback value (→ fail), `min` above the level (→ fallback), an extra field on a known event (used, field ignored), an unknown `ApiError` code with `compat`. Red-check against the pre-change strict decoder.

## 2. The line for generation slots (server)

- [x] 2.1 `SlotController`: an async FIFO acquire for `generate` with abort. `release()` stays idempotent and hands the slot to the head of the line. Position tracking and change notifications. Bounded by `WHIM_QUEUE_MAX` (default 50). Tests: order, abort mid-line moves everyone up, drain empties the line, overflow refused. All bounded by timeouts (see the `whim-node-suite-bare-await-hang` memory).
- [x] 2.2 `routes/generate.ts`: keep credit, daily-limit and content-policy checks pre-stream. When no slot is free, open the stream and emit `queued{position}` on entry, on every move and at least every 5 s. Start the pipeline on a slot, and spend the daily unit only then. `WHIM_QUEUE_MAX_WAIT_MS` (default 180000) → one terminal `failure` (`queue_timeout`). Line full → pre-stream `429 server_busy`. Tests for every `server-admission-control` line scenario, including "no daily unit spent" on timeout and abort.
- [x] 2.3 Config: parse `WHIM_QUEUE_MAX`, `WHIM_QUEUE_MAX_WAIT_MS` and `WHIM_PROVIDER_QUANTIZATIONS`. `requestBody` sends `provider.quantizations` when it's set, and the provider object is byte-identical when unset (test). Add the three rows to `docs/deploy.md` (D8, D12).

## 3. Generation quality (server)

- [x] 3.1 One list of mini-app limits interpolated into `CLARIFY_SYSTEM` and `REWRITE_SYSTEM`. Clarify returns `limit{reason, alternative}` (no questions) when the request's core needs a listed capability. For a partly impossible request, no option is offered for the extra and the plan says it's left out (D9). The prompts suite pins both prompts to the list, and fails when the capability registry gains a capability the list names as missing. The clarify route validates the `limit` arm.
- [x] 3.2 Retry a generate/repair turn once on an upstream failure. If the turn already yielded `token` events, emit `restart` first (D10). Tests: a failure before the first token retries without `restart`; a failure mid-turn emits exactly one `restart` and can deliver; a second failure is terminal; the failed attempt's usage is metered.
- [x] 3.3 `stages/run.ts` passes a content-free `{kind, check}`. The machine logs it at info with `requestId` on `containment_failed`/`run_unverified` (D11). A test asserts the fields and that no source/DOM/console text appears.
- [x] 3.4 Reproduce #106 and locate the path. Enforce: no-change only for byte-identical source, and a neutral line otherwise (D13). Test with a generated-output-shaped fixture.
- [x] 3.5 Clarify prompt sets `select` and `other` per question (D18). Plan writing decides every `decide: true` question and names the decision in the plan, and honours several `choices`. `server/src/policy/input.ts` classifies `choices` and `other` with the prompt on rewrite and generate. Tests: a delegated question's decision appears in the plan (stub model); harmful `other` text is refused like a harmful prompt; the prompts suite pins the answer-mode instructions.

## 4. Prompt-flow screens for the new messages (app)

- [x] 4.1 Build screen: while the latest event is `queued`, show "in line, N ahead" with Cancel and "Leave it running". Switch to progress at the first `stage`. The stall heartbeat counts `queued` and `restart` (modified `prompt-flow` requirement).
- [x] 4.2 On `restart`, discard the current turn's activity signals (characters written, etc.) and continue without a failure state. Test against a stream fixture that writes, restarts, then delivers.
- [x] 4.3 Clarify `limit`: a screen with the reason, "Build <alternative> instead" (the alternative becomes the prompt and re-enters clarify) and "Change my idea". No generation starts on its own.
- [x] 4.4 Wire the decoder's fallback outcomes (1.3) into the flow. `fail` → failure screen with the notice as plain text; `update` → the update screen with the notice. The pending record resolves as failed, and nothing is installed or updated. Tests for mid-build and unary (clarify/rewrite) cases.
- [x] 4.5 Clarify step: pills allow one or several picks per `select`, an "Other" text field when `other` is true, and "Decide for me" on every question (it clears picks and text). Answers are threaded as `choices`/`other`/`decide`. Tests for each prompt-flow clarify scenario. The "Other" field joins chain-6's keyboard wrapper list.

## 5. Age check and legal flow (app)

- [x] 5.1 Bound `runAgeCheck` with a 3 s deadline that resolves `unavailable` through the existing reduction (D1). Test with a never-settling `read` and a fake clock: the flow ends on the terms step. Red-check against the unbounded version.
- [x] 5.2 `WhimAgeSignal.acknowledgeSignificantUpdate(description)`: Swift via `AgeRangeService.showSignificantUpdateAcknowledgment` on iOS 26.4+ (R7), the `.mm` binding and the TS spec, resolving `acknowledged | declined | unavailable`. Older iOS and Android → `unavailable` (D2).
- [x] 5.3 Request it only for `minor-approved` with an older accepted terms version, bounded by its own 60 s deadline (R7). `declined` keeps AI off, `unavailable` proceeds, and only the outcome is stored, per terms version. Tests for every `store-age-signals` scenario.
- [x] 5.4 Route Settings "Turn on AI features" through `nextLegalStep` (D6). Tests: outdated terms → terms then one consent; current terms → one consent; no legal screen twice in a pass.
- [x] 5.5 Reword `openspec/changes/developer-observability/tasks.md` 8.2(a): an up-to-date grant isn't re-asked, and a grant older than `AI_CONSENT_VERSION` is.

## 6. Keyboard in the host shell (app)

- [x] 6.1 Build the shared keyboard-safe wrapper from React Native built-ins (D3). Put pure logic in a non-RN sibling so a Node suite can test it.
- [x] 6.2 Compose: the wrapper, Continue pinned in the footer, no `autoFocus`, and Done on the description field.
- [x] 6.3 Adopt the wrapper on every other screen and sheet with a TextInput (clarify "Other", plan editing, "Change it", report sheet, settings/server fields). List each one in the chain report. `SheetModal`'s `KeyboardAvoidingView` is kept or folded in, not doubled.

## 7. Realm and host runtime (app runtime + SDK)

- [ ] 7.1 In `loader.js`, scroll a focused editable element into view on focus and on viewport resize (D3).
- [ ] 7.2 A runtime-owned root error boundary posts a nonce-authenticated `render` error frame, and the host treats `render` as fatal (D4). Tests: trusted `render` → FailureScreen; untrusted → ignored.
- [ ] 7.3 The theme payload gains the sanitized, clamped `chromeInsetBottom`, computed by the host from the orb size, margin and bottom safe-area inset on every mount (D5).
- [ ] 7.4 SDK `Screen` adds `chromeInsetBottom` to its scrollable content's bottom padding; generated code can't read it. `sdk:test` covers with and without an inset.
- [ ] 7.5 `npm run build`, then `npm run invariants` and `npm run bridge:invariants` green.

## 8. Diagnostics and polish (app)

- [ ] 8.1 `thrownFields` reduces frames to file name + line:column on every platform (D7). Test with an iOS-shaped stack. A trimmed stack still symbolicates to the same lines.
- [ ] 8.2 The orb scrim covers the status bar, and the Android grey disc is gone (D14).
- [ ] 8.3 Re-check #48 and fix only if it reproduces. Examples get distinct declared tile colours, with a test that they're pairwise distinct.
- [ ] 8.4 `toLocaleString('en-CA')`. `run-signals.suite.ts` passes under `LANG=fr_CA.UTF-8`.

## 9. Release upgrade check (tooling)

- [ ] 9.1 Maestro seed flow for the previous release: an example with saved data, and a generated app with two versions. It records what was seeded.
- [ ] 9.2 `scripts/release/upgrade-check.sh --platform android|ios --from <old> --to <new>`: fresh device, install old, seed, install new over it, assert tiles, versions, data, consent state and device id, and exit non-zero on any difference.
- [ ] 9.3 `docs/release/mobile.md`: the upgrade check is required before any beta build ships, and the doc says where the evidence goes.

## 10. Acceptance and rollout (orchestrator, attended)

- [ ] 10.1 `gate-full.sh` green on the staging tip, then the reviewer pass.
- [ ] 10.2 Load-test `e2-standard-2` (`deploy/loadtest/run.sh drive`). Put the highest caps with p95 CPU < 70 % and no failed runs into the `server/src/config.ts` defaults (R8; the standard profile sets no server limit), and record the run in `docs/deploy.md`.
- [ ] 10.3 Flowbench before and after 3.1 (visible set plus weather and roommate-ping cases), recorded in `progress.md`.
- [ ] 10.4 iOS and Android builds → a newly created simulator and a fresh emulator against a local server at the staging tip: every tier-0 scenario, the line (cap + 2), the `limit` screen, and a fallback smoke (a dev-only injected future frame).
- [ ] 10.5 Upgrade check 382511 → beta-1 on both platforms, with evidence recorded.
- [ ] 10.6 After merge: server deploy from `../Whim-deploy`, smoke, one real generation, and a line check. Confirm 381237/382511 now get 426. Roll back by `--tag` on failure.
- [ ] 10.7 Upload to TestFlight `Public beta` and the Play closed track. Owner's demo-phone check (real-device age signals, keyboard, a generation).
- [ ] 10.8 Raise `WHIM_MIN_BUILD_IOS`/`_ANDROID` to beta-1's builds (D17), and close the issues this change fixes, with evidence.
