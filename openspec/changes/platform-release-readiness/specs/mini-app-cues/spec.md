## ADDED Requirements

### Requirement: Sound cues play on iOS from the Android tone table
The iOS host SHALL provide a `WhimTone` native module with the same `play(token)` contract as Android, and SHALL render each token from the Android tone descriptors, cut to Android's play windows.
`tick` is a 400 Hz plus 1200 Hz dual tone for 40 ms. `chime` is one 1200 Hz tone for 100 ms. `alarm` is three 1319 Hz bursts of 125 ms starting 250 ms apart. Any other token plays as `tick`. Playback SHALL be fire-and-forget. It SHALL mix with other audio, follow the ringer volume and the Silent switch, and never surface an error to JavaScript.

#### Scenario: A stage cue sounds on an iPhone
- **WHEN** a mini-app with the `cues` capability calls `cues.sound('chime')` on an iPhone with the Silent switch off
- **THEN** one short 1200 Hz tone plays and the syscall resolves without waiting for it

#### Scenario: The Silent switch mutes sound but not haptics
- **WHEN** the Silent switch is on and a mini-app fires `cues.sound('alarm')` and `cues.haptic('heavy')`
- **THEN** no tone is heard and the phone still vibrates

#### Scenario: An unknown token falls back
- **WHEN** the native module receives a token outside `tick`, `chime` and `alarm`
- **THEN** it plays the `tick` tone and raises nothing
