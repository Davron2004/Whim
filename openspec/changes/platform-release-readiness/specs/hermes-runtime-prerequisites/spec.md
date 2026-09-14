## ADDED Requirements

### Requirement: The app entry installs runtime prerequisites before anything else evaluates
The app entry `index.js` SHALL begin with a side-effect import of the entry prerequisites installer, with no statement of any kind before it, so the installer runs before any other module of the app evaluates.
The version store and the storage engine SHALL also import the prerequisites module for its side effect, so each still has its globals when loaded some other way.

#### Scenario: The storage engine loads first on Hermes
- **WHEN** a Hermes build starts with `RUN_STORAGE_PROBE` enabled, so the storage engine loads before any version-store module
- **THEN** the app doesn't crash and the storage probe reports its verdict

#### Scenario: A late prerequisites import fails the checks
- **WHEN** `index.js` imports `react-native` before the prerequisites installer
- **THEN** the release checks fail, naming `index.js` and the statement that comes first

### Requirement: Prerequisites fill only what the runtime lacks
The prerequisites installer SHALL install `TextEncoder`, `TextDecoder`, `Buffer` and `process.env` on the target global object only where each is missing, and SHALL never replace a value the runtime already provides.
Each global SHALL be checked on every call, so a second call fills anything still missing and changes nothing else.

#### Scenario: A bare runtime gets every global
- **WHEN** the installer runs against an empty global object
- **THEN** that object has working `TextEncoder`, `TextDecoder`, `Buffer` and `process.env`, and a UTF-8 round trip through the codecs returns the original string

#### Scenario: A native global is kept
- **WHEN** the installer runs against a global object that already has a `TextDecoder`
- **THEN** that same `TextDecoder` is still there afterwards

### Requirement: process.platform reports the real operating system and is never guessed
When the runtime lacks `process.platform`, the entry installer SHALL set it to the operating system React Native reports (`ios` or `android`). No code path SHALL write a platform value it didn't get from React Native.
An installer call made without a platform SHALL leave a missing `process.platform` missing. An existing `process.platform` SHALL never be overwritten.

#### Scenario: iOS reports ios
- **WHEN** the app starts on an iPhone under Hermes
- **THEN** `process.platform` is `ios`

#### Scenario: A call without a platform doesn't guess
- **WHEN** the installer runs without a platform against a global object whose `process` has no `platform`, and later runs with `android`
- **THEN** `process.platform` is missing after the first call and `android` after the second
