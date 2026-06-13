# effects-and-cues — English test specs (§16.5)

*Written before any implementation. Tasks 3.x implement §1 against the Node suite; task 4.3
checks §2 in desktop Chromium; §3 is the on-device acceptance + the two statements handed to
the **separate runtime-owner session** (tasks 7.x — never authored here).*

---

## 1. Bridge surface — `bridge:test` assertions (deterministic, Node, recording-fake backend)

These extend `src/host/bridge/test/acceptance.ts` with a new section (§G — cues). A
**recording-fake `CueBackend`** records every `(method, token)` it is asked to perform; the
suite asserts on that log. No React Native is loaded.

- **G1 — a second/third capability is still one row + one stub.** `createDefaultRegistry({
  cueBackend })` registers exactly `cues.haptic` and `cues.sound` and nothing else new; the
  registry's method list gains those two and only those two. (Append-only intact: a duplicate
  cue registration throws at startup, like every other row.)
- **G2 — undeclared `cues` is denied with a fix hint.** An app whose host-held manifest lacks
  `cues` that calls `cues.haptic` gets `undeclared_capability`, the denial names `cues`, the
  hint points at the `defineApp` capabilities array, and the backend is **never invoked**.
- **G3 — an off-set token names its alternatives.** `cues.sound` with a `name` outside the
  closed set is denied `invalid_params`, and the hint **enumerates the valid sound tokens**
  (`tick`, `chime`, `alarm`). Same for `cues.haptic` with a bad `kind` (lists `tap`, `double`,
  `heavy`). A missing/!=string token is also `invalid_params`.
- **G4 — a valid cue invokes the backend exactly once and resolves `{}`.** `cues.haptic`
  with `{kind:'double'}` (manifest declares `cues`) returns an ok sysret whose result is `{}`
  (fire-and-forget, nothing observable), and the recording fake logs exactly one
  `haptic:double`. Likewise `cues.sound` → `sound:<name>`.
- **G5 — a deduped retry does not double-buzz.** The same `cues.haptic` frame (same id+gen)
  delivered twice yields two identical ok sysrets **and the backend is invoked exactly once**
  (the dispatcher's existing dedup, exercised for a side-effecting verb).
- **G6 — a stale-generation cue frame is dropped and fires nothing.** A `cues.sound` frame
  stamped with a prior generation returns `null` (dropped) and the backend is never invoked.
- **G7 — missing backend → structured handler error, never an unshaped throw.**
  `createDefaultRegistry()` with **no** `cueBackend` still registers the cue rows (so denials
  stay testable); calling a *declared* `cues.haptic` resolves to an **error** sysret with a
  structured `{kind, hint}` (the dispatcher shapes the handler's throw into `handler_error`
  whose hint says the cue backend is unavailable) — the bundle sees a rejected promise, not a
  crash.
- **G8 — the gate order holds for cues.** An undeclared-`cues` app calling an *unregistered*
  cue-ish method still reports `unknown_method` first (registration is checked before
  capability), same fixed order as storage.
- **G9 — the #41 review rule: the diff touches no transport/dispatcher module.** Adding cues
  changes only `contract.ts` (types), `rows.ts` (two rows), and `index.ts` (the registry
  factory) on the bridge side — `dispatcher.ts`, `gate.ts`, `registry.ts`, `launch.ts`
  unchanged. (Asserted by review/`git diff`, recorded in the close-out, not by a runtime
  check.)

## 2. SDK effects — desktop fixture check (task 4.3; the fast filter, not the acceptance)

Checked in desktop Chromium against a built fixture; the property names, not the timing:

- **E1 — a countdown ticks without touching the bridge.** A mini-app with `capabilities: []`
  running a 1-second `interval` that updates on-screen state re-renders each tick, and **zero
  `whim:'syscall'` frames** are observed on the transport for the timer's lifetime.
- **E2 — sequencing with `delay`.** `await delay(ms)` between two state updates applies the
  second update after at least `ms`, with no bridge traffic.
- **E3 — unmount cancels the interval by construction.** When the component holding a live
  `interval` unmounts, its callback never fires again — with **no cleanup code written by the
  app author** (the hook owns teardown).
- **E4 — a paused interval does not tick.** Rendering `interval(..., { running: false })`
  fires no callback until `running` becomes true again.

## 3. On-device acceptance + the two runtime-owner invariant statements

### 3a. Pour-over fixture acceptance (task 8.1 — the real verdict)

- The `pour-over-timer` fixture (declares only `cues`, no storage) is delivered through the
  normal deliver path on a real Android device.
- Its staged brew advances on an SDK `interval` countdown; a `delay`-driven 3-2-1 get-ready
  beat precedes brewing.
- At each **stage transition** the device **vibrates and plays the stage cue**
  (`cues.haptic('double')` + `cues.sound('chime')`); at **done** it plays the **alarm**
  (`cues.haptic('heavy')` + `cues.sound('alarm')`).
- The containment verdict stays **CONTAINED ✓** throughout; system back / relaunch behave
  sanely; `npm run invariants` stays 42/42 and the bridge suites stay green.

### 3b. Invariant statements handed to the runtime-owner session (tasks 7.x — NOT authored here)

- **INV-TIMER (timer teardown):** A bundle starts a fast `interval` that marks each tick
  observably; the host resets the realm (iframe recreation, carry-forward #5) and delivers a
  second generation. From the **trusted vantage** (F4 — never the bundle's self-report),
  **zero gen-1 ticks** are observed after the reset boundary. (Effects spec: "A gen-1 interval
  never ticks into gen-2".)
- **INV-CUEGATE (hostile cue denial end-to-end):** A hostile bundle in the **real sandbox**
  attempts cue syscalls without the `cues` capability, with off-set params, and with a forged
  self-posted `sysret`. Trusted-vantage observation shows structured denials
  (`undeclared_capability` / `invalid_params`), an **inert forgery**, and **zero fake-backend
  invocations**. The suite's negative control stays non-vacuous (it must still be able to catch
  a real breach). (Cues spec: "A hostile bundle cannot cue past the gate".)
