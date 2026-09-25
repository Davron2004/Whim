## Context

The demo signups get their first invite with the build this change produces
(`docs/beta-readiness-2026-09-24.md`). It's a batch of independent fixes, not one feature. What
holds them together: the first session has to work on both platforms, the server has to survive the
invite burst, and nothing may break the two TestFlight builds already in people's hands (381237,
382511). Terrain claims below cite `research.md` (R).

## Goals / Non-Goals

**Goals:**
- No path in the first session ends on a blank or stuck screen: age check, keyboard, legal flow,
  render errors.
- Every generated app is fully visible and usable: orb inset, and keyboard inside mini-apps.
- A burst of simultaneous generations degrades into a short wait, not an instant refusal, on the
  production machine.
- Fewer failed or misleading builds: capability-aware clarify, one pre-stream retry, honest "No changes".
- Every beta build proves it upgrades cleanly over the previous one.

**Non-Goals:**
- Any wire-contract change: a new `GenerationEvent` type or stage value, or a clarify schema arm.
  The shipped builds fail closed on unknown frames (R: Constraints).
- A generation queue visible in the app (queue position, ETA). That needs a new event type.
- #67 (distinctive apps), #52's example-set rethink, #65 attestation, #66 outage messaging: tier 2.
- OS backup policy (#72's second half).
- New native dependencies.

## Decisions

**D1. The age deadline lives in JS, in `runAgeCheck`, at 3 s.** It races `read()` against a timer and
maps expiry to `unavailable`, which goes through the existing reduction (`allowed`). One bound covers
iOS and Android and every native variant. The dangling native promise is harmless: the call has no
side effects the flow depends on. *Alternative:* a Swift `Task` deadline. It only covers iOS, and #100
shows that native calls can be the thing that never returns. The 3 s figure comes from #100's measurement
(it restores the whole flow) and matches the community workaround range (R: Apple).

**D2. Significant-change acknowledgment (#86) runs in the age-check phase, for supervised minors only.**
A new native method on `WhimAgeSignal` calls `AgeRangeService.showSignificantUpdateAcknowledgment`
(iOS 26.2+) and resolves `acknowledged | declined | unavailable`. JS calls it only when all three hold:
iOS, this pass's age signal is `minor-approved`, and the stored terms acceptance is for an older terms
version. It's bounded by D1's deadline. `declined` keeps AI features off, like `minor-not-approved`.
`unavailable` (older iOS, timeout, error) proceeds, matching the documented age-signal fallback (#78).
After an acknowledgment only the outcome is stored, keyed by terms version, so the parent isn't asked
again for the same version. The raw age signal is still never stored. *Why not everyone:* Apple frames
the API as guardian consent (R: Apple). Calling it for adults has no documented meaning. *Alternative:*
record that it doesn't apply. Rejected: Texas names significant changes explicitly, and the wiring is small.

**D3. Keyboard handling uses React Native built-ins in one shared host wrapper.** No keyboard library:
`react-native-keyboard-controller` needs Reanimated, which Whim doesn't have. The wrapper:
- ScrollView with `automaticallyAdjustKeyboardInsets` (iOS), `keyboardDismissMode` `interactive`
  on iOS and `on-drag` on Android, and `keyboardShouldPersistTaps="handled"`.
- A footer slot for the primary action inside `KeyboardAvoidingView` (iOS `padding`; Android keeps
  `adjustResize`, R).
- Tap-on-empty-space to dismiss, and an iOS `InputAccessoryView` "Done" on multiline fields, since
  Return inserts a newline there.

Compose drops `autoFocus`, so the "start from" suggestions are visible on arrival (#49's open question).
Every screen with a TextInput (Compose, Plan, "Change it", sheets) uses the wrapper. Inside mini-apps:
the runtime loader (host code, not generated code) scrolls the focused element into view on focus and on
viewport resize. So the SDK contract is intact (#11).

**D4. A runtime-owned error boundary at the realm root reports post-paint render failures as fatal.**
The loader mounts the app inside its own boundary. On catch it posts a trusted error frame with
`where:'render'`, and the host adds `render` to `isFatalErrorWhere`. That reaches the existing
FailureScreen and its recovery (realm recreate, R). *Alternative:* inferring "root empty after a runtime
error". Rejected as racy. It also needs DOM inspection timing that the boundary makes unnecessary.

**D5. The orb's footprint enters the realm through the theme channel.** `installTheme`'s payload gains a
sanitized, clamped (0–200) number, `chromeInsetBottom`. The SDK's `Screen` adds it to the bottom
padding of its scrollable content, so the last element can always scroll clear of the orb. Generated
code never sees the number (#11/#13). *Alternatives:* shrink or fade the orb, or a host bar. Both leave
content under chrome at some scroll position, or cost screen height in every app.

**D6. Settings → "Turn on AI features" goes through `nextLegalStep` from the start (#104).** Terms not
current means terms first, then one consent screen. Otherwise, one consent screen. Invariant: one pass
through the legal flow shows each legal step at most once. `legalScreen` stays the only builder (R).

**D7. Stack frames are reduced to file name + line:column in `thrownFields`, on every platform (#101).**
Android already sends base names, and symbolication already works from them. So this makes iOS match
and removes the per-install folder UUID.

**D8. Admission waits briefly for a generation slot, first come first served, then refuses as today (#118).**
`SlotController` gets an async acquire for `generate` with a FIFO waiter list.
- **Limits:** `WHIM_ADMISSION_WAIT_MS` (default 10000) and `WHIM_ADMISSION_MAX_WAITERS` (default 2×
  the generation cap). Config refuses a wait of 14000 ms or more, because the device fails a request
  that hasn't produced a first chunk in 15 s (R), and old builds can't change that.
- **Exit paths:** a waiter leaves on client disconnect or drain. Overflow is refused immediately.
  `release()` stays idempotent and hands the slot to the head waiter.
- **Check order:** unchanged (credit → slot → daily unit → content policy), so nothing is charged
  while waiting.
- **Caps:** the load test (`deploy/loadtest/run.sh drive`) on `e2-standard-2` picks the caps: the
  highest pair whose p95 CPU stays under 70 % with no failed runs. They go into
  `deploy/profiles/standard.env`, and `docs/deploy.md` records the numbers.
- **Rejected:** a `queued` SSE event (breaks shipped builds). Opening the stream before admission
  with keepalives (commits a 200 before a refusal is known, and whether a comment frame disarms the
  device timer is unverified, R).

**D9. One list of mini-app limits feeds both clarify and plan writing (#62/#70).** A single constant
(network and live data, notifications while closed, other people's devices, the camera, and whatever
else the capability registry lacks) is interpolated into `CLARIFY_SYSTEM` and `REWRITE_SYSTEM`. It
comes with instructions: don't offer these, and turn an impossible ask into the nearest buildable
version, with the plan saying so plainly. A server test pins both prompts to the list, and fails if the
capability registry gains a capability the list says is missing. No schema change: the substitution is
carried in the plan rows the user already sees. Effect measured with `server/flowbench.mjs` on the
visible set plus a "weather app" case before and after.

**D10. An engineer turn is retried once, only before anything reached the device (#57).** The
conditions: an upstream failure (5xx, 429, network or stream error) in a generate/repair turn, and no
`token` event from that turn yielded yet. The same messages are sent once more. Otherwise the turn stays
terminal, as today. The failed attempt's usage is still metered. This is narrower than the retry
machine.ts:217 declined, which concerned partial output (R).

**D11. The run stage keeps a content-free verdict summary through to the machine (#58).** `stages/run.ts`
passes `{kind, check}` (an enumerated verdict kind and the id of the check that tripped, with no source,
DOM or console text). The machine logs it at info with `requestId` on `containment_failed` /
`run_unverified`. The ledger is unchanged (closed codes, no prose).

**D12. `WHIM_PROVIDER_QUANTIZATIONS` optionally sets `provider.quantizations` (#68).** Unset keeps
today's routing. It's read through the roster/config seam, never a literal. The operator sets it only
after a flowbench comparison. `docs/deploy.md` gets the row.

**D13. "No changes" is decided by source equality, not by the model (#106).** The task starts by
reproducing and locating the save path (R: not traced). The rule it enforces: for a change request,
a summary may claim no change only when the delivered source is byte-identical to the source the
request started from. If the source differs, the summariser is told so, and a no-change claim gets a
neutral fallback line. If the investigation finds the save path at fault instead, the fix goes there,
under the same rule.

**D14. Polish.**
- #48: re-check first; fix only if it still reproduces (R).
- Examples declare explicit, distinct tile colours through the existing declared-colour path, and
  `appColor` stays untouched (shared by every surface, R).
- #105: the scrim is drawn as a status-bar-translucent full-window layer, and Android drops the
  `elevation` shadow that paints the disc.
- #89: `toLocaleString('en-CA')`.

**D15. The upgrade check is a script plus a recorded run.**
- `scripts/release/upgrade-check.sh` installs the previous release on a fresh emulator/simulator and
  seeds it: an example app with saved data, and a generated app with two versions.
- It then installs the new build over it (`adb install -r`, `simctl install`) and asserts the tiles,
  versions, data, consent state and device id are the same, driven by Maestro.
- `docs/release/mobile.md` makes it a required step before a beta build ships. Results go into the
  change's `progress.md`.

## Risks / Trade-offs

- [3 s cuts off a slow but real age answer] → it lands as `unavailable` → allowed, the same fail-open
  the policy already documents (#78); the demo-phone check watches for it.
- [Keyboard behaviour differs by platform and screen] → one wrapper, checked on every input screen on
  both platforms during release acceptance.
- [The wait adds up to 10 s before a refusal] → only when all slots are busy; the refusal copy is
  unchanged.
- [The retry doubles provider spend on the failure path] → one retry, pre-stream only; still metered.
- [A quantization floor shrinks the provider pool] → off by default; set only on measurement.
- [The guardian dialog's behaviour is barely documented] → bounded, `unavailable` proceeds, and it's
  called only for `minor-approved`.
- [A new `where:'render'` frame reaching an old host] → the host and realm ship together in one app
  build; there's no cross-version pairing.

## Migration Plan

1. Merge. Deploy the server first. It's legacy-safe (no contract change) and brings D8–D13.
   Smoke, one real generation, and a two-device concurrency check against the new caps. Roll back
   by `--tag` on failure.
2. iOS and Android builds → a new simulator and a fresh emulator → the upgrade check (D15) from
   382511 → the demo phone.
3. Add to TestFlight `Public beta` and the Play closed track. Invites go out after the owner looks at
   the build.

## Open Questions

- Does the rewrite request carry the base source (needed by D13), or does the device know it? The
  implementer settles it in D13's investigation.
