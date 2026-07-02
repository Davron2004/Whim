# mini-app-cues — delta for `effects-and-cues`

## ADDED Requirements

### Requirement: Physical cues are manifest-gated syscalls under one `cues` capability

Haptic and audio cues SHALL cross the bridge as syscalls — methods `cues.haptic` and
`cues.sound` — gated by a single `cues` capability in the host-held manifest. Each SHALL land
as exactly one registry row plus one typed `vc-sdk` stub, with zero edits to the transport or
dispatcher (#41's review rule — this change is the append-only readiness test). The stubs
SHALL hold nothing stronger than the existing one-way syscall transport.

#### Scenario: Haptics is one row and one stub

- **WHEN** the diff that lands `cues.haptic` is reviewed
- **THEN** the bridge changes consist of registry-row and contract-type additions plus the SDK
  stub, with the transport and dispatcher modules untouched

#### Scenario: An undeclared cue is denied with a fix hint

- **WHEN** a bundle whose manifest lacks `cues` calls `cues.haptic`
- **THEN** the gate denies with structured `undeclared_capability` data whose hint names the
  missing capability, and no cue fires

#### Scenario: A hostile bundle cannot cue past the gate

- **WHEN** a hostile bundle in the real sandbox attempts cue syscalls without the capability,
  with forged params, or with a forged self-posted sysret
- **THEN** trusted-vantage observation shows structured denials, an inert forgery, and zero
  backend invocations (invariant authored in a runtime-owner session; suite remains
  non-vacuous via its negative control)

### Requirement: Cue vocabularies are closed token sets resolved host-side

Cue parameters SHALL be closed token sets (haptic kinds; sound names), validated before
dispatch. An off-set token SHALL produce the gate's structured `invalid_params` denial whose
hint lists the valid tokens (the §8.1 self-repair shape). The mapping from token to vibration
pattern or tone SHALL live host-side only — no duration, pattern, asset, or raw value is
expressible from the bundle.

#### Scenario: An off-set token names its alternatives

- **WHEN** a bundle calls `cues.sound` with a name outside the closed set
- **THEN** the denial is `invalid_params` and its hint enumerates the valid sound tokens

### Requirement: Cue delivery is fire-and-forget and at-most-once

Cue syscalls SHALL resolve as soon as the cue is triggered, exposing no completion, duration,
or device state (cues add zero sensing surface). Delivery SHALL be at-most-once per request
id: a retried frame replays the recorded outcome without re-firing the cue, and a
stale-generation or torn-down-realm frame fires nothing.

#### Scenario: A deduped retry does not double-buzz

- **WHEN** the same `cues.haptic` frame is delivered twice within a realm generation
- **THEN** the backend is invoked exactly once and both deliveries resolve identically

#### Scenario: A late cue from a dead realm is silent

- **WHEN** a cue frame stamped with a stale generation arrives after a realm reset
- **THEN** it is dropped and the backend is never invoked

### Requirement: Cue rows bind to an injected backend, not to RN imports

The cue registry rows SHALL derive their effect from an injected cue backend interface, so the
bridge modules remain importable under Node (the deterministic suites) and the host can swap
the audio implementation without touching the syscall contract. A registered row with no
backend available SHALL surface a structured handler error, never an unshaped throw.

#### Scenario: The Node suite drives cues against a fake

- **WHEN** the bridge test suite registers cue rows with a recording fake backend
- **THEN** gate order, denials, dedup, and backend invocations are all assertable with no
  React Native dependency loaded

### Requirement: The pour-over timer comes alive on-device

A foreground pour-over-timer fixture (declaring only `cues`, no storage) SHALL run its staged
brew on SDK effects and fire haptic + sound cues at stage transitions, on a real Android
device through the normal deliver path — the §15.2 v0.3 acceptance, with containment still
green throughout.

#### Scenario: Stage transitions buzz and the finish chimes

- **WHEN** the pour-over fixture runs on-device and a brew stage completes
- **THEN** the device vibrates and plays the stage cue, the final stage plays the alarm cue,
  and the isolation suites report no regression
