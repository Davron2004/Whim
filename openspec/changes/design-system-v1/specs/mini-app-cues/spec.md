## MODIFIED Requirements

### Requirement: Cue vocabularies are closed token sets resolved host-side

Cue parameters SHALL be closed token sets (haptic kinds; sound names), validated before
dispatch. An off-set token SHALL produce the gate's structured `invalid_params` denial whose
hint lists the valid tokens (the §8.1 self-repair shape). The mapping from token to haptic or
tone SHALL live host-side only — no duration, pattern, asset, or raw value is expressible from
the bundle. Haptic kinds SHALL play through the `WhimHaptics` native module on the platforms'
haptic engines: `tap` as a light impact (Android `EFFECT_CLICK`), `double` as two light impacts
80 ms apart (`EFFECT_DOUBLE_CLICK`), `heavy` as a heavy impact (`EFFECT_HEAVY_CLICK`); RN
`Vibration` SHALL NOT be used.

#### Scenario: An off-set token names its alternatives

- **WHEN** a bundle calls `cues.sound` with a name outside the closed set
- **THEN** the denial is `invalid_params` and its hint enumerates the valid sound tokens

#### Scenario: A tap is a short tap on iOS

- **WHEN** a bundle with the `cues` capability calls `cues.haptic('tap')` on an iPhone
- **THEN** the backend plays one light impact through `WhimHaptics`, not a vibration

## ADDED Requirements

### Requirement: Haptic cues are rate-capped host-side

The host SHALL cap `cues.haptic` at 10 per second per realm with a burst of 3: a call over the
cap SHALL be dropped (not queued) and SHALL still resolve as delivered, exposing nothing to the
bundle. The cap SHALL apply after the at-most-once dedupe, so a deduped retry never counts twice.

#### Scenario: A burst is trimmed

- **WHEN** a bundle calls `cues.haptic('tap')` 20 times within 100 ms
- **THEN** the backend plays at most 3, every call resolves, and a later call after a second plays again
