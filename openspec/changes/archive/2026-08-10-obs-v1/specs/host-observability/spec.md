## ADDED Requirements

### Requirement: Every screen renders inside a recoverable error boundary
Every launcher screen SHALL render inside a React error boundary. A render, lifecycle, or
effect-mount throw in any screen SHALL be caught by that boundary and SHALL NOT unmount the
launcher tree. The boundary SHALL render a recoverable error screen carrying a plain-English
message and a retry affordance that remounts the failed subtree, and SHALL reset when the active
screen changes, so a screen that failed once is reachable again by navigating away and back.

The boundary SHALL NOT be placed inside individual screen components. It SHALL wrap the launcher's
screen-switch boundary, so screen coverage is a property of the router rather than of each
screen's own source.

#### Scenario: A screen throws during render
- **WHEN** a launcher screen throws while rendering
- **THEN** the recoverable error screen is shown in place of that screen, the rest of the shell
  (status-bar inset, safe-area frame) still renders, and the app is not left blank

#### Scenario: Retry remounts the failed screen
- **WHEN** the user taps retry on the recoverable error screen
- **THEN** the failed screen's subtree is remounted from scratch, and a screen whose throw was
  transient renders normally

#### Scenario: Navigating away clears the boundary
- **WHEN** a screen has failed and the user navigates to a different screen and back
- **THEN** the boundary has reset and the screen is attempted again rather than staying in its
  error state

#### Scenario: The boundary never swallows
- **WHEN** the boundary catches any throw
- **THEN** a log record carrying the error class, message, stack, and the identifier of the screen
  that failed is emitted through the logging seam before the error screen renders

### Requirement: One logging seam; `console.*` is not a device log surface
The device SHALL expose exactly one logging seam. Every device-side diagnostic SHALL be emitted
through it, and no module outside that seam SHALL call `console.*` for diagnostics. The seam SHALL
provide ordered severity levels and named channels, and SHALL accept a structured payload (an
object of named fields) alongside the message rather than a pre-formatted string.

The string prefixes in use today SHALL become channels of this seam and SHALL NOT survive as
literals at their call sites: `whim:gen` (generation client and transport), `whim` (the mini-app
container), `whim:page` (the relayed sandbox-page log). Channel names SHALL be declared in one
place; a call site SHALL NOT invent one.

#### Scenario: A breadcrumb carries structure, not a formatted string
- **WHEN** the generation client logs a mapped transport error
- **THEN** the record carries the error kind, HTTP status, ready state, and detail as named
  fields, and the channel as a channel rather than as a prefix inside the message

#### Scenario: The seam is the only console caller
- **WHEN** the source of `src/host/` outside the logging seam is scanned for diagnostic
  `console.*` calls
- **THEN** none is found

#### Scenario: Levels order and filter
- **WHEN** the seam's threshold is set above a record's level
- **THEN** that record is neither buffered nor delivered to any sink

### Requirement: Every log record is a structured event held in a bounded ring buffer
The seam SHALL retain recent records in an in-memory ring buffer of fixed capacity. When the
buffer is full the oldest record SHALL be evicted; the buffer SHALL NOT grow without bound and
SHALL NOT be persisted to disk on the device. Each retained record SHALL carry a timestamp, level,
channel, message, and its structured fields, and SHALL be readable synchronously as a snapshot so
a reader never observes a partially-written record.

#### Scenario: Capacity is enforced by eviction
- **WHEN** more records are emitted than the buffer's capacity
- **THEN** the buffer holds exactly its capacity, the oldest records are gone, and the newest are
  present in emission order

#### Scenario: A snapshot is stable
- **WHEN** a reader takes a snapshot and further records are emitted
- **THEN** the snapshot it holds is unchanged

### Requirement: Sensitive fields are structurally unloggable on the device
The seam SHALL make the repo's privacy floor a property of the code path rather than a convention:
prompt text, generated mini-app source, the `x-whim-device` value, and any model-provider API key
SHALL NOT appear in any emitted record, in the ring buffer, or in anything a sink receives. A
record whose structured fields carry a sensitive key SHALL have that value replaced with a fixed
redaction marker before the record is buffered, so redaction cannot be lost by a sink that
serializes differently from another.

#### Scenario: A sensitive field is redacted at the seam
- **WHEN** a caller passes a field named for prompt text, device id, or an API key
- **THEN** the buffered record carries the redaction marker in that field's place, and the
  original value appears in no sink

#### Scenario: Redaction is not sink-dependent
- **WHEN** the same record is read by the overlay and by the batching sink
- **THEN** both observe the redacted value

### Requirement: No error is swallowed silently
A caught error SHALL NOT be discarded unseen. A **discard-shaped** catch — one whose block is
empty, or one that never binds the error and neither rethrows nor calls the logging seam — SHALL
be a lint error, enforced by the core `no-restricted-syntax` rule with AST selectors over catch
clauses — no new lint plugin and no new dependency. A catch that binds the error and handles it
(maps it into state, a return value, a user-facing message, or an assertion) is outside the
selectors by design: that is handling, not swallowing, and a rule that fires on handling gets
disabled repo-wide. A genuinely intentional silent catch SHALL carry an inline disable comment
stating the site-specific reason (`-- intentional: <reason>`); an undocumented one SHALL fail the
gate. (Measured 2026-08-08: the un-narrowed "neither throws nor logs" selector fires 108 times
repo-wide, mostly on legitimate handlers; the discard-shaped selectors fire 62 times, all real
silent swallows.)

The rule SHALL apply to catch clauses only. A rejected-promise handler (`.catch(fn)`) is outside
its selector, and the change SHALL NOT pretend otherwise.

Every discard-shaped catch inside this change's jurisdiction — the launcher, the capability
bridge, and `src/host/cue-backend.ts` — SHALL be migrated to log through the seam or converted to
a documented intentional disable where logging is demonstrably noise (test harnesses). The alert
paths, though not discard-shaped (they bind and display the error), SHALL additionally emit a seam
record. Discard-shaped catches in subsystems this change does not touch (version store, storage
engine, SDK, synthrun, server generation internals, repo tooling) carry permanent documented
`intentional:` disables instead — the rule still polices all future code there.

#### Scenario: A silent catch fails lint
- **WHEN** a discard-shaped catch is added — empty body, or bindingless with neither throw nor
  seam call — carrying no disable comment
- **THEN** `npm run lint` fails with the tripwire's message

#### Scenario: A rethrow satisfies the rule
- **WHEN** a catch block rethrows
- **THEN** the tripwire does not fire

#### Scenario: The alert paths now log
- **WHEN** opening, forking, or deleting an installed app fails
- **THEN** the user still sees the alert, and a record carrying the error class, message, stack,
  and the failing operation is emitted through the seam

### Requirement: The dev log overlay reads the ring buffer and cannot reach a shipping build
The device SHALL provide an in-app overlay that renders the ring buffer's snapshot: newest-first,
one row per record showing timestamp, level, channel, and message, with the structured fields
available on the row and filtering by channel and by minimum level. It SHALL be built from stock
`View`/`Text`/`FlatList` primitives with no third-party overlay dependency.

The overlay SHALL be reachable only from the same developer affordance that already gates the
device probe screen, and SHALL be absent from a shipping build. Because this project's working
build recipe is a release build — where `__DEV__` is `false` — the gate SHALL NOT be `__DEV__`
alone: it SHALL be `__DEV__` **or** an explicit build-time flag defaulting to `false`, following
the existing `RUN_*_PROBE` idiom, so the overlay is reachable in a locally-built release APK and
still cannot ship.

#### Scenario: The overlay renders what the buffer holds
- **WHEN** the overlay is opened after records have been emitted
- **THEN** it lists those records newest-first with their level and channel, and no record the
  buffer holds is missing

#### Scenario: Filtering narrows without mutating
- **WHEN** the user filters to one channel
- **THEN** only that channel's records are listed, and clearing the filter restores the full list
  unchanged

#### Scenario: Shipping builds have no overlay
- **WHEN** the app is built with the developer flag off and `__DEV__` false
- **THEN** no affordance opens the overlay and the overlay screen is not reachable by any route

### Requirement: Batched delivery to the dev sink is best-effort and never affects the app
The seam SHALL offer a sink that batches records and POSTs them to the dev server's log-sink
route. Batching SHALL be bounded by both a record count and a flush interval, SHALL drop the
oldest pending records rather than growing without bound, and SHALL be off unless explicitly
enabled.

Delivery SHALL be best-effort: a sink failure — unreachable host, non-2xx, timeout — SHALL NOT
surface to the user, SHALL NOT throw into the caller's stack, SHALL NOT block rendering or any
generation request, and SHALL NOT be retried indefinitely. A sink failure SHALL itself be recorded
in the ring buffer, so the overlay can explain why nothing is arriving on the host, and SHALL NOT
recurse into another delivery attempt for that record.

The sink's destination SHALL be the server address the device already persists, reached over
`adb reverse` port forwarding; no second address is configured and no new setting is added.

#### Scenario: Records are batched, not sent one by one
- **WHEN** several records are emitted inside one flush interval
- **THEN** they are delivered as a single request body

#### Scenario: An unreachable sink is invisible to the user
- **WHEN** the sink's host refuses the connection
- **THEN** no alert, toast, or error screen appears, the in-flight generation is unaffected, and a
  record noting the delivery failure is in the ring buffer

#### Scenario: The failure record does not recurse
- **WHEN** a delivery failure is recorded
- **THEN** recording it does not itself trigger another delivery attempt for that record

#### Scenario: Off by default
- **WHEN** the sink has not been explicitly enabled
- **THEN** no network request is made by the logging seam
