## MODIFIED Requirements

### Requirement: The delivered app record is harness-validated

The `WireAppRecord` a run delivers SHALL be assembled only from harness outputs: `name`, `manifest`, and
`schema` SHALL come from the check report's statically extracted `defineApp` argument, and `bundle` and
`sourceMap` SHALL come from building the candidate under the production bundle contract. The pipeline SHALL
NOT re-parse the source for manifest data, ask the model to restate the manifest, or accept a manifest from
any other source — there is exactly one extraction. A record SHALL be delivered only for a candidate whose
check stage produced no error diagnostics and whose run report is green and untruncated.

An app's `tint` and `icon` are manifest data and SHALL follow that same single extraction: they reach the
record only from the literal `defineApp` argument the check stage already extracted, never from the model's
prose, a second parse, or anything the candidate reports at run time. The check stage SHALL resolve them
through the shared name resolver (aliases, then the deterministic fallback) and SHALL record a warning
diagnostic for every alias or fallback it applied; a tint or icon name SHALL never be an error, fail a run or
trigger a repair turn. A legacy `tileColor` SHALL be carried through unvalidated for the host to map.

#### Scenario: Manifest comes from extraction, not from the model

- **WHEN** the model's prose claims a capability the source does not declare
- **THEN** the delivered record's manifest reflects the source's `defineApp` argument, not the prose

#### Scenario: Bundle honours the production contract

- **WHEN** a delivered record's bundle is compared with the production build pipeline's output for the same
  source
- **THEN** they are byte-identical

#### Scenario: Nothing is delivered without a green run

- **WHEN** a candidate passes the check stage but its run report carries an error diagnostic
- **THEN** no `result` is emitted for that candidate

#### Scenario: The tile colour comes from the one extraction

- **WHEN** a candidate declares `tint: ['rose', 'stone']` and `icon: 'coffee'`
- **THEN** the delivered manifest carries exactly those values, and the source is not re-parsed for them

#### Scenario: A near-miss name is a warning, not a failure

- **WHEN** a candidate declares `icon: 'alert-circle'` and `tint: 'teal'`
- **THEN** the manifest carries `circle-alert` and `ocean`, two warning diagnostics are recorded, and the run is otherwise unaffected

#### Scenario: A reserved or malformed colour is dropped

- **WHEN** a candidate declares a legacy `tileColor` that is malformed or equal to a reserved status hue
- **THEN** the run is otherwise unaffected, the manifest carries the literal unvalidated, and no tile shows that colour: the host maps a hex to the nearest tint and drops anything else for the app's fallback tint

### Requirement: Clarify picks each question's answer mode, and delegated questions are decided in the open
The clarify prompt SHALL instruct the model to mark a question `select: 'many'` only when several options can sensibly hold together, and `other: true` only when the options can't cover the likely answers. Because the plan page shows the questions beside the plan and "Decide for me" is every question's default, plan writing SHALL leave every question on the page out of the plan rows, and generation SHALL decide every question still delegated with `decide: true` and follow every answered one.

#### Scenario: Delegated question
- **WHEN** a rewrite request carries a clarification with `decide: true` for "Which units?"
- **THEN** no returned plan row states or decides the units

#### Scenario: Generation decides what was delegated
- **WHEN** a generate request carries "Which units?" with `decide: true`
- **THEN** the generated app uses one unit system the engineer chose

#### Scenario: Several picks honoured
- **WHEN** a clarification carries two `choices`
- **THEN** the generated app includes both

### Requirement: The run stage is the synthetic harness, and containment failure is terminal

The run stage SHALL execute the candidate through the synthetic run harness against the built bundle, and
SHALL derive its verdict only from the harness's report. Error-severity runtime diagnostics SHALL send the
candidate to repair. A run report whose containment verdict is negative SHALL end the run **immediately
with a `failure` terminal event, consuming no repair attempt and feeding nothing back to the model** — the
loop does not iterate on escape attempts. A truncated run SHALL be reported as such rather than treated as
a pass. The pipeline SHALL NOT reimplement, approximate, or relax any part of the harness's containment,
gate, or page assembly.

A run report whose containment verdict is **unobserved** — the harness heard no authenticated verdict at
all — SHALL also end the run immediately with a `failure` terminal event, consuming no repair attempt and
feeding nothing back to the model, and SHALL NOT be treated as contained under any circumstance: not after
any number of attempts, not as a fallback, and not on a last attempt. It SHALL be a distinct outcome from a
negative verdict, carrying its own user-facing reason and the harness's own named unobserved-verdict
diagnostic; the pipeline SHALL NOT report it as a containment failure. Its reason SHALL say that the app
could not be verified, and SHALL NOT assert that the app was unsafe or that a breach was observed. Like
every reason the device shows, it SHALL use typographic apostrophes and the product glossary. An
unobserved verdict SHALL NOT be automatically re-run: the candidate is not rebuilt, re-executed, or
re-prompted, and the device's existing retry affordance remains the recovery path.

No detail of a rejected forgery — its payload, its count, or the fact of it — SHALL reach any model-facing
path, because a diagnostic the candidate authored and the repair loop consumed would be a prompt-injection
channel.

#### Scenario: Containment failure short-circuits

- **WHEN** a candidate's run report reports a negative containment verdict
- **THEN** the run ends with a single `failure` terminal event, no repair prompt is built, and no candidate
  source or diagnostic derived from the escape attempt is sent back to the model

#### Scenario: An unobserved verdict short-circuits with its own reason

- **WHEN** a candidate's run report carries an unobserved containment verdict
- **THEN** the run ends with a single `failure` terminal event whose `reason` is
  "We couldn’t verify this app ran safely. Please try again." — distinct from the containment-failure
  reason, stating that the app could not be verified rather than that it was unsafe — and no repair
  prompt is built

#### Scenario: An unobserved verdict consumes no repair attempt and is never delivered

- **WHEN** a run's first candidate returns an unobserved containment verdict
- **THEN** the terminal `failure` event's attempt count reflects that no repair attempt was spent, no
  `result` is emitted, and the candidate is not re-run

#### Scenario: A runtime throw is repaired

- **WHEN** a candidate mounts and then throws in a handler during the sweep
- **THEN** the run-observed diagnostic is forwarded and a repair attempt is made with it in context

#### Scenario: Truncation is not a pass

- **WHEN** a candidate's run exceeds the harness's total budget and the report is marked truncated
- **THEN** the run does not deliver on that candidate

#### Scenario: Forgery detail never reaches the model

- **WHEN** a candidate's run report records rejected forgeries and the run ends
- **THEN** no prompt the pipeline builds contains the forgery count, the forged payload, or any reference
  to the rejection

## ADDED Requirements

### Requirement: Clarify options are short enough to read as answers
The clarify prompt SHALL cap every option at 40 characters, written as the answer itself, and the corpus eval SHALL track the share of options over 40 characters.

#### Scenario: A long option is caught by the eval
- **WHEN** the eval runs a corpus case whose clarify response has a 52-character option
- **THEN** the case reports an option-length violation

### Requirement: Plan rows are written for the app
The rewrite prompt SHALL write each plan row's label for the app in at most three words in sentence case (no fixed label set), and each row's text in at most two sentences of about 140 characters, leaving out detail the person didn't ask about. Rows SHALL NOT restate a question shown on the same page. A limit reason SHALL use the product glossary ("apps", never "mini-apps").

#### Scenario: Labels fit the app
- **WHEN** a habit tracker's plan is written
- **THEN** its labels name parts of that app (for example "Ticking a habit"), not a fixed set like "When a step ends"

### Requirement: The generator learns tiles and defaults from the reference, not from layout rules
The SDK reference SHALL describe exactly what the SDK does, including `tint` and `icon` with the ten tints, the glyph groups and four rules (pick the glyph for what the app is about; rank up to three tints by the subject's feeling; names up to 24 characters; keep the tile when changing unless asked). The generate prompt SHALL NOT dictate a layout (no "main content inside a Card" recipe) and SHALL point at the SDK's defaults. The corpus eval SHALL check that every generated app names a valid tint and icon, that a change keeps them, and SHALL track the invalid-icon rate.

#### Scenario: A change keeps the tile
- **WHEN** the eval changes an app that named `ocean` and `glass-water`
- **THEN** the changed app still names `ocean` and `glass-water`

#### Scenario: The reference has no stale theming
- **WHEN** `docs/sdk-reference.md` is checked against the SDK's exports
- **THEN** it documents no preset, shape or `tileColor`, and documents every exported component
