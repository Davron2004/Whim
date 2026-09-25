## ADDED Requirements

### Requirement: Diagnostic stacks carry file names, not install paths
The app SHALL reduce every stack frame's location to its file name plus line and column before a diagnostic leaves the phone, on every platform.

#### Scenario: iOS stack
- **WHEN** a fatal diagnostic is captured on iOS with frames under `…/Bundle/Application/<UUID>/Whim.app/main.jsbundle`
- **THEN** the uploaded frames read `main.jsbundle:<line>:<column>` with no folder path

#### Scenario: Symbolication still works
- **WHEN** a trimmed release stack is symbolicated with the build's source map
- **THEN** it resolves to the same source locations as before trimming
