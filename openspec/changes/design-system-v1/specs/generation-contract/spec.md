## MODIFIED Requirements

### Requirement: Wire app record
The contract SHALL define `WireAppRecord` = `{ name, source, bundle, sourceMap?, manifest,
schema }` — the verified-bundle payload a generation delivers. It MUST NOT contain device-side
identity or install state (ids, install timestamps, launcher position, assigned tint, tile
overrides): the stored record is the launcher's concern, the wire record is this contract's.

An app's tile identity SHALL ride inside `manifest` — the same statically extracted structure that
already carries capabilities — as `tint` (the app's ranked tint names, resolved to the closed set) and
`icon` (its resolved glyph name), and SHALL NOT become top-level fields, because manifest data has exactly
one source. A legacy `tileColor` MAY still appear in `manifest` from an older build. The manifest remains
an untyped record on the wire; the host validates and assigns where it consumes it.

#### Scenario: Wire record is install-state-free
- **WHEN** `WireAppRecord` is inspected
- **THEN** it has no app-id, install-state or assigned-tint fields, and a `result` event validates with only
  generation outputs

#### Scenario: Tile identity has one home
- **WHEN** a delivered record for an app that named a tint and an icon is inspected
- **THEN** `tint` and `icon` appear inside `manifest` and nowhere else on the record
