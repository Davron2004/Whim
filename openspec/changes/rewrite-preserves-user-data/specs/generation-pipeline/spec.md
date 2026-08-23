## ADDED Requirements

### Requirement: The edit turn sees the app it is changing

The generate turn for a request carrying `app` SHALL render the pre-flighted `app.source` verbatim under a `Current source:` block, and the prompt SHALL NOT state that source is included when it is not.

The same turn SHALL carry three continuity instructions:

- the app SHALL keep its current name unless the user's request asks for a rename;
- every concept that already exists SHALL keep the burned collection and field ids it already has, because the user's rows live under those ids and a new id is a new, empty table or column;
- the storage locations the current source reads and writes — the kv keys and record collections named in it — SHALL be listed, with the instruction to keep reading and writing them and to add locations rather than replace them.

When `app.source` is absent or failed pre-flight, no `Current source:` block and no storage-location list SHALL be rendered, and the honest-regeneration path SHALL be unchanged. A request with no `app` SHALL carry none of these instructions.

#### Scenario: The edit turn contains the current source it claims to contain

- **WHEN** the generate messages are built for a request whose `app.source` is present
- **THEN** the user message contains a `Current source:` block holding that source verbatim

#### Scenario: The edit turn asks for identity continuity

- **WHEN** the generate messages are built for an edit request
- **THEN** the user message instructs the model to keep the app's existing name unless a rename was asked for, and to keep the existing burned collection and field ids for concepts that already exist

#### Scenario: The edit turn names the locations the data lives under

- **WHEN** the generate messages are built for an edit whose current source reads a kv key `habitCompletionHistory` and a collection `Completions`
- **THEN** the user message names both locations and instructs the model to keep reading and writing them, adding locations rather than replacing them

#### Scenario: A new-app turn carries no continuity instructions

- **WHEN** the generate messages are built for a request with no `app`
- **THEN** the user message contains no `Current source:` block, no storage-location list, and no identity-continuity instruction

### Requirement: The storage-surface instruction and the drift check read one scanner

The set of storage locations rendered into the edit turn and the baseline the static checker compares a candidate against SHALL be produced by the same exported scanner, invoked once per run on the pre-flighted source.

The pipeline SHALL NOT re-derive either value by a second scan, by hand-maintained lists, or by parsing the source a second time in a different module.

#### Scenario: One scanner, two consumers

- **WHEN** a run builds an edit turn and then checks the candidate it produced
- **THEN** the prompt's location list and the checker's baseline come from the same scanner result, and no second storage-name extractor exists in the pipeline's sources

### Requirement: The SDK reference documents the storage schema artifact

The SDK reference the prompt feeds the model verbatim SHALL document the storage schema artifact: collections keyed by display name over a burned `id`, fields keyed by display name over a burned `id` and one of the six field types, the `tombstones` list, and that a `date` field is an epoch-millisecond **integer**, never a formatted date string.

It SHALL also state that `Chart`'s `DayPoint.date` is a `YYYY-MM-DD` label string belonging to the chart component and unrelated to the storage `date` field type. A tripwire in the prompt suite SHALL fail when the schema-artifact section is missing, when any of the six field types is unnamed, or when the epoch-millisecond statement is absent.

#### Scenario: An undocumented schema shape fails the build

- **WHEN** the SDK reference carries no schema-artifact section naming all six field types
- **THEN** the prompt suite fails naming what is missing

#### Scenario: The two dates are disambiguated

- **WHEN** the SDK reference is read for the word `date`
- **THEN** the storage field type is documented as an epoch-millisecond integer and the chart's `DayPoint.date` is explicitly marked as a label string that is not that type

## MODIFIED Requirements

### Requirement: Generation allocates burned field IDs above the accumulated floor

For a request carrying an applied schema, the pipeline SHALL communicate the per-collection burned-ID floor
(the maximum ordinal among the accumulated union's active and retired columns) to the model as a hard
constraint, and SHALL rely on the static checker to reject any new field ID at or below that floor. The
floor SHALL be computed from the applied schema the request carries — never from the candidate's own schema
artifact, and never re-derived from the app's stored snapshot.

The floor SHALL be **stated numerically per collection**, computed with the storage engine's exported
`burnedIdFloor` and never re-derived locally. The same context SHALL instruct the model to KEEP the
existing ids for the concepts that already have them and to allocate NEW ids only for genuinely new
concepts, strictly above the floor. It SHALL NOT instruct the model to avoid the existing ids as such:
an existing id is what the user's data is stored under, and only a *reallocation* of a retired or
occupied id is forbidden.

#### Scenario: The floor reaches the model

- **WHEN** a request carries an applied schema whose highest ordinal in a collection is 7
- **THEN** the generate and repair prompts state that new field IDs in that collection start above 7

#### Scenario: Existing concepts keep their ids

- **WHEN** a request carries an applied schema
- **THEN** the prompt instructs the model to reuse the existing collection and field ids for the concepts
  that already exist, and contains no instruction to avoid those ids

#### Scenario: An under-floor allocation is repaired, not shipped

- **WHEN** a candidate allocates a new field ID at or below the floor
- **THEN** the check stage reports it, the candidate goes to repair, and no record is delivered carrying
  that allocation
