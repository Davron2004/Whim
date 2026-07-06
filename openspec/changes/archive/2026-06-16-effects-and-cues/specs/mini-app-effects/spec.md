# mini-app-effects — delta for `effects-and-cues`

## ADDED Requirements

### Requirement: Timed effects are web-resident SDK exports, never syscalls

`vc-sdk` SHALL export `delay(ms)` (a Promise) and `interval(callback, ms, opts?)` (a React
hook) as the mini-app's only taught path to time. Both MUST execute entirely inside the
sandboxed realm as wrapped web timers: invoking them SHALL emit no syscall frame, require no
manifest capability, and pass through no gate. The SDK timer layer SHALL hold nothing stronger
than the one-way `parent.postMessage` transport already permitted (spike-2 carry-forward #2).

#### Scenario: A countdown ticks without touching the bridge

- **WHEN** a mini-app with `capabilities: []` runs a one-second `interval` updating on-screen
  state
- **THEN** the countdown renders each tick, and no `whim:'syscall'` frame is observed on the
  transport for the lifetime of the timer

#### Scenario: Sequencing with delay

- **WHEN** an event handler runs `await delay(ms)` between two state updates
- **THEN** the second update applies after at least `ms` elapsed, with no bridge traffic

### Requirement: Interval effects clean up on unmount by construction

`interval` SHALL be scoped to the mounting component such that unmounting cancels the
underlying timer automatically — there SHALL be no API shape in which the author can start a
repeating timer without that cleanup attached (spec §5.5). Pause/resume SHALL be expressible
without tearing the hook down.

#### Scenario: Navigating away stops the tick

- **WHEN** a screen with a live `interval` unmounts
- **THEN** its callback never fires again, with no cleanup code written by the app author

#### Scenario: A paused interval does not tick

- **WHEN** an `interval` is rendered with its running option set to false
- **THEN** the callback does not fire until the option becomes true again

### Requirement: Realm teardown cancels every timer

A host-forced realm reset (iframe recreation, spike-2 carry-forward #5) SHALL cancel all
timers the outgoing generation scheduled — `delay` and `interval` alike. No timer scheduled in
generation N may fire any observable effect in generation N+1. This property is a sandbox
never-regress invariant, verified from the trusted vantage (F4 — never the bundle's
self-report) and authored in a runtime-owner session.

#### Scenario: A gen-1 interval never ticks into gen-2

- **WHEN** a bundle starts a fast `interval` and marks each tick observably, and the host then
  resets the realm and delivers a second generation
- **THEN** trusted-vantage observation shows zero gen-1 ticks after the reset boundary

### Requirement: Sandbox neutralization stays surgical with respect to timers

The sandbox SHALL NOT strip `setTimeout`/`setInterval` (they are pure web-resident time,
load-bearing for React's scheduler and the syscall marshaller — #35's strip-the-capability
rule). Steering generated code toward `delay`/`interval` is the prompt's and the static
check's job (SDK lint, #9), not the runtime's.

#### Scenario: The allowed runtime still schedules

- **WHEN** the containment probes run in a freshly hardened realm with the SDK timer layer
  active
- **THEN** the existing isolation suite still passes in full (no new strip, no CSP or
  allowlist drift)
