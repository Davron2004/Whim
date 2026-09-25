## Context

The demo signups get their first invite with the build this change produces
(`docs/beta-readiness-2026-09-24.md`). It's a batch of fixes plus one structural addition: a wire
protocol that can grow. The owner decided on 2026-09-25 that the installed builds (381237, 382511, only
on the owner's and his mom's phones) are **not** a constraint: this change breaks them on purpose and
retires them with the minimum-build gate. Where `research.md` (R) lists "shipped clients fail closed on
unknown frames" as a constraint, that's a fact about today's code, and this change replaces it.

The same decision creates the one hard constraint that remains: beta-1 is the first build testers keep,
so its decoder is the oldest reader every later server must serve (short of a forced update).
Forward compatibility therefore has to ship in this build. It can't be added after.

## Goals / Non-Goals

**Goals:**
- A protocol that can gain messages without breaking installed apps: old apps degrade to a declared
  fallback instead of failing to parse.
- No path in the first session ends on a blank or stuck screen: age check, keyboard, legal flow,
  render errors.
- Every generated app is fully visible and usable: the orb inset, and the keyboard inside mini-apps.
- A burst of simultaneous generations becomes a visible line, not a refusal.
- Fewer failed, misleading or wasted builds: "can't build this" before a build is spent, a
  provider-drop retry, and an honest "No changes".
- Every beta build proves it upgrades cleanly over the previous one.

**Non-Goals:**
- Compatibility with 381237/382511 (retired by the minimum builds, D17).
- Server-sent executable behaviour of any kind (D16 explains why the fallback is declarative).
- #67 (distinctive apps), #52's example-set rethink, #65 attestation, #66 outage messaging: tier 2.
- OS backup policy (#72's second half). New native dependencies.

## Decisions

**D16. Forward compatibility is three layers plus the existing forced update.**
- **Layer 1, tolerant reader:** known messages ignore unknown fields. All contract object schemas
  strip rather than reject, and a test pins that.
- **Layer 2, negotiation (the workhorse):** every `/v1` request sends `x-whim-protocol: <int>`
  (the contract exports `PROTOCOL_LEVEL`, 1 in beta-1). The server reads it at the request edge
  beside the request envelope. Any emitter of a message, field or code introduced above level 1 must
  consult it and send a lower-level form or the fallback. A request with no level gets
  `426 update_required` (the existing update-gate response and screen). That retires every pre-beta build.
- **Layer 3, in-band fallback (the safety net):** every SSE event and unary body may carry
  `compat: {min, fallback, notice?}`. The device decodes in two phases:
  1. A permissive envelope (`type`/`error` string plus optional `compat`).
  2. The full schema, only when the type/code is known and `min ≤ PROTOCOL_LEVEL`.

  Otherwise it applies the fallback:
  - `skip`: continue.
  - `fail`: the failure screen with `notice` as plain text.
  - `update`: the update screen with `notice`.

  No `compat` on an unknown message, or an unknown fallback value, means `fail`. The set
  {skip, fail, update} is frozen: it never gains a member or changes meaning, because it's the one
  thing the oldest build must understand forever.
- **Layer 4, forced update:** the existing minimum-build gate (`WHIM_MIN_BUILD_*`, 426) for when
  nothing sensible can be sent.

*Prior art:* the tolerant reader (protobuf unknown fields), server-side version adaptation (Stripe's
pinned API versions), per-message fallbacks (Slack's fallback text, Matrix's `body`, PNG's critical bit,
email `multipart/alternative`).

*Rejected:*
- Server-sent closures/code. Whoever controls a response would control the host (the trust root), and it
  conflicts with App Store 2.5.2.
- An app-version-based `min`. Versions differ by platform and lane; a single protocol level doesn't.
- Fallback-only without negotiation. It would make every new feature degrade in old apps instead of
  being adapted for them.

*Limit:* the fallback can't rescue a change in the meaning of an existing message. That requires a
level bump plus server-side adaptation (layer 2).

**D1. The age deadline lives in JS, in `runAgeCheck`, at 3 s.** It races `read()` against a timer, and
expiry maps to `unavailable` through the existing reduction (`allowed`). One bound covers iOS, Android
and every native variant. The dangling native promise has no side effect the flow depends on.
*Alternative:* a Swift `Task` deadline. It covers iOS only, and #100 shows native calls can be the
thing that never returns. 3 s is #100's measured fix and sits inside the community's workaround range
(R: Apple).

**D2. Significant-change acknowledgment (#86) is asked in the age-check phase, for supervised minors only.**
- A new `WhimAgeSignal` method calls `AgeRangeService.showSignificantUpdateAcknowledgment` (iOS 26.2+)
  and resolves `acknowledged | declined | unavailable`.
- JS calls it only when all three hold: iOS, this pass's signal is `minor-approved`, and the stored
  terms acceptance is for an older terms version. It's bounded by D1's deadline.
- `declined` keeps AI features off (like `minor-not-approved`). `unavailable` proceeds (the documented
  age-signal fallback, #78).
- Only the outcome is stored, keyed by terms version. The raw signal is never stored.

*Why not everyone:* Apple frames the API as guardian consent (R: Apple), and for adults it has no
documented meaning.

**D3. Keyboard handling uses React Native built-ins, in one shared host wrapper.** No keyboard library:
`react-native-keyboard-controller` requires Reanimated, which Whim doesn't have. The wrapper:
- An inset-adjusting ScrollView (`automaticallyAdjustKeyboardInsets` on iOS), `keyboardDismissMode`
  `interactive` (iOS) / `on-drag` (Android), and `keyboardShouldPersistTaps="handled"`.
- A footer slot for the primary action in `KeyboardAvoidingView` (iOS `padding`; Android keeps
  `adjustResize`).
- Tap on empty space to dismiss, and an iOS `InputAccessoryView` "Done" on multiline fields.

Compose drops `autoFocus`. Every screen with a TextInput uses the wrapper. Inside mini-apps, the runtime
loader (host code) scrolls the focused element into view on focus and on viewport resize, so the SDK
contract is intact (#11).

**D4. A runtime-owned error boundary at the realm root reports post-paint render failures as fatal.**
The loader mounts the app inside its own boundary. On catch it posts a trusted error frame with
`where:'render'`, and the host adds `render` to `isFatalErrorWhere`. That reaches the existing
FailureScreen and recovery (realm recreate, R). *Alternative:* inferring "root empty after a runtime
error". Rejected as racy.

**D5. The orb's footprint enters the realm through the theme channel.** `installTheme`'s payload gains a
sanitized, clamped (0–200) `chromeInsetBottom`. The SDK's `Screen` adds it to its scrollable content's
bottom padding. Generated code never sees the value (#11/#13). *Alternatives:* shrinking or fading the
orb, or a host bar. Both leave content under chrome at some point, or cost height in every app.

**D6. Settings → "Turn on AI features" goes through `nextLegalStep` from the start (#104).** One pass
shows each legal step at most once. `legalScreen` stays the only builder (R).

**D7. Stack frames are reduced to file name + line:column in `thrownFields`, on every platform (#101).**
Android already sends base names and symbolication works from them. This makes iOS match.

**D8. A generation that finds every slot busy waits in a line on its own stream (#118).**
- **Before the stream:** admission still runs the credit check, the daily-limit checks and the
  content policy before opening it, so refusals keep their HTTP codes. The daily-limit check confirms
  a unit is available; the unit is spent only when a slot is taken.
- **Joining the line:** the route opens the SSE stream, adds the generation to a FIFO line held by
  `SlotController` (async `acquire` with abort), and emits `queued{position}` on entry, on every move
  and at least every 5 s. The device's first-chunk timer (R: 15 s) and the stall heartbeat both see
  activity.
- **Leaving the line:** a slot → the normal pipeline starts. Line full (`WHIM_QUEUE_MAX`, default 50)
  → pre-stream `429 server_busy`. Waited `WHIM_QUEUE_MAX_WAIT_MS` (default 180000) → terminal
  `failure` with the new code `queue_timeout`. Client abort or drain → the waiter leaves, holds
  nothing, spends nothing.
- `release()` stays idempotent and hands the slot to the head of the line.
- **Caps:** a load test (`deploy/loadtest/run.sh drive`) on `e2-standard-2` picks them (the highest
  pair with p95 CPU < 70 % and no failed runs), set in `deploy/profiles/standard.env`, with the
  numbers recorded in `docs/deploy.md`.
- **Level gating:** `queued` is level 1, so every beta build knows it. A future line feature (ETA,
  priority) would be a new level, adapted per D16.

*Rejected:* a pre-stream bounded wait (the earlier draft). It was only needed to keep the retired
builds working, and it gives the user no feedback.

**D9. One list of mini-app limits feeds clarify and plan writing, and clarify can say "can't build"
(#62/#70).**
- A single constant (network and live data, notifications while closed, other people's devices, and
  whatever else the capability registry lacks) is interpolated into `CLARIFY_SYSTEM` and
  `REWRITE_SYSTEM`.
- When a request's core needs a listed capability, clarify returns `limit{reason, alternative}` with no
  questions. The app shows the reason, "Build <alternative> instead" (the alternative becomes the
  prompt and re-enters clarify), and "Change my idea".
- A partly impossible request gets no option for the impossible extra, and the plan says it's left out.
- A prompts-suite test pins both prompts to the list, and fails when the capability registry gains a
  capability the list calls missing.
- The effect is measured with `server/flowbench.mjs` (visible set plus weather and roommate-ping cases)
  before and after.

**D18. Clarify questions carry their answer mode, and the user can delegate any question.**
- `ClarifyQuestion` gains `select: 'one' | 'many'` and `other: boolean`. The model sets both:
  several picks only when options can hold together, and a typed answer only when the options can't
  cover likely answers.
- The device adds "Decide for me" to every question. It isn't model-controlled, so the option is always
  there. It clears picks and typed text.
- `Clarification` becomes `{id, question, choices, other?, decide?}`, with either `decide: true` alone
  or at least one choice or `other`.
- The plan writer decides delegated questions and names each decision in the plan, so the approval
  gate shows what Whim picked. Skipped (unanswered) questions keep today's meaning.
- The typed `other` text is user free text entering a model, so `server/src/policy/input.ts` classifies
  it with the prompt (the content-policy delta).
- The "Other" field uses the keyboard wrapper (D3).

*Why now:* these are wire shapes. With D16 in place they could come later, but only as a level-2
change with the server adapting questions for beta-1 apps forever after. In beta-1 they're part of
the baseline for free.

**D10. A model turn that loses its provider is retried once, at any point (#57).**
- On an upstream failure (5xx, 429, network or stream error) in a generate/repair turn, the machine
  resends the same messages once.
- If the turn had already yielded `token` events, it first emits `restart`, and the device discards that
  turn's activity signals.
- A second failure is terminal, as today. The failed attempt's usage is metered.

This differs from the retry machine.ts:217 declined: that one concerned partial output reaching the
record. Here the partial output is explicitly voided.

**D11. The run stage keeps a content-free verdict summary through to the machine (#58).**
`stages/run.ts` passes `{kind, check}`, and the machine logs it at info with `requestId` on
`containment_failed`/`run_unverified`. The ledger is unchanged.

**D12. `WHIM_PROVIDER_QUANTIZATIONS` optionally sets `provider.quantizations` (#68).** It goes through
the config/roster seam, and is unset by default. It's set only after a flowbench comparison.

**D13. "No changes" is decided by source equality, not by the model (#106).** First reproduce the bug and
locate the save path (R: not traced). A no-change claim is allowed only when the delivered source is
byte-identical to the starting source; otherwise the summariser is told the source changed, and a
no-change claim is replaced by a neutral line. If the save path is at fault, it's fixed under the same
rule.

**D14. Polish.**
- #48: re-check first, and fix only if it still reproduces.
- Examples declare distinct tile colours; `appColor` is untouched (R).
- #105: the scrim becomes a status-bar-translucent full-window layer, and the Android `elevation`
  disc goes.
- #89: `toLocaleString('en-CA')`.

**D15. The upgrade check is a script plus a recorded run.** `scripts/release/upgrade-check.sh`:
1. Installs the previous release on a fresh emulator/simulator.
2. Seeds it with Maestro: an example app with saved data, and a generated app with two versions.
3. Installs the new build over it.
4. Asserts tiles, versions, data, consent state and device id.

`docs/release/mobile.md` makes it a required step. The previous build for beta-1 is 382511: the
check proves that data survives even though the wire broke.

**D17. The minimum builds retire the pre-beta installs.** Once beta-1's builds are on TestFlight
`Public beta` and the Play closed track, set `WHIM_MIN_BUILD_IOS`/`_ANDROID` to their build numbers.
381237/382511 then already get 426 from the missing protocol header (D16), and the minimum builds keep
it that way for any future pre-D16 build too.

## Risks / Trade-offs

- [A wrong `compat`/level on a new message ships a bad fallback] → an emitter-side test: every
  event or code above level 1 carries `compat`, and a client-side "future frames" fixture suite covers
  each fallback.
- [The frozen fallback set turns out too small] → by design. A richer degradation is a server-side
  adaptation (layer 2), never a new fallback.
- [The line hides a capacity problem] → the queue length and wait are logged. A line that's often
  long means raising caps or moving to the event profile.
- [3 s cuts off a slow real age answer] → it lands `unavailable` → allowed (#78); watched in the
  demo-phone check.
- [Keyboard behaviour differs by platform and screen] → one wrapper, checked on every input screen on
  both platforms.
- [A restart doubles provider spend on the failure path] → one retry per turn; metered.
- [A quantization floor shrinks the provider pool] → off by default.
- [The guardian dialog is barely documented] → bounded, `unavailable` proceeds, `minor-approved` only.

## Migration Plan

1. Merge. Build iOS and Android. Check on a new simulator and a fresh emulator against a local
   server at the staging tip. Run the upgrade check 382511 → beta-1 (D15).
2. Deploy the server (from `../Whim-deploy`), smoke, one real generation, and a line check: cap + 2
   simultaneous generations; the extras show `queued` and then run. From here 381237/382511 get 426,
   as intended.
3. Upload beta-1 to TestFlight `Public beta` and the Play closed track. Update the owner's and his
   mom's phones. Demo-phone check.
4. Raise the minimum builds to beta-1 (D17). Invites follow once the owner has looked at the build.

Rollback: the server rolls back by `--tag`. With the old server, the beta-1 app gets no `x-whim-protocol`
support, which is harmless: the old server ignores the header, and the app decodes old-shape messages
as level 1.

## Open Questions

- Does the rewrite request carry the base source (needed by D13), or does the device know it? This is
  settled in D13's investigation.
