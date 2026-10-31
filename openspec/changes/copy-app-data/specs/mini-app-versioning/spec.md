## ADDED Requirements

### Requirement: A version's declaration is readable without its code
The store SHALL provide an additive read verb (`declarationOf`) that returns one snapshot's manifest and schema as saved and reads no other file of the version (not its code, source or prompt.md). A file the snapshot does not hold SHALL be reported as missing (`null`). An unknown snapshot SHALL be refused as `getSnapshot` refuses it. The verb SHALL take only the app and the snapshot id (no file path) and return no git terminology or identifiers; existing verbs are unchanged.

#### Scenario: Manifest and schema returned, code not read
- **WHEN** a snapshot holds a bundle, a source, a manifest and a schema, and `declarationOf` is called for it
- **THEN** the result carries the manifest and the schema exactly as saved, and neither the bundle, the source nor the prompt was read from storage

#### Scenario: A missing file is reported as missing
- **WHEN** `declarationOf` is called for a snapshot saved without a schema, and for one saved without a manifest
- **THEN** the first reports its schema as missing and the second reports both as missing

#### Scenario: An unknown snapshot is refused
- **WHEN** `declarationOf` is called with a snapshot id the app does not have, or for an app with no history
- **THEN** it rejects naming the unknown snapshot, as `getSnapshot` does
