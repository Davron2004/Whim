# mini-app-storage delta — storage-semantic-guards

## MODIFIED Requirements

### Requirement: Reads can be filtered, ordered, and bounded host-side

`records.list` SHALL accept `where` (per-field equality or range `gt/gte/lt/lte`, AND-composed), `orderBy` (one field, asc/desc), `limit`, and `offset`, evaluated in the engine — so a bounded query returns only the matching subset rather than the full collection. `json`-typed fields are opaque payloads and SHALL NOT be accepted in `where` or `orderBy`: a query naming a `json`-typed field there MUST be refused with a structured `unqueryable_field` error whose hint directs the caller to filter on a scalar field or promote the queried value into its own declared field. No SQL is executed for a refused query and the engine's storage is unchanged.

#### Scenario: A time-bucketed query returns only the bucket

- **WHEN** a collection holds records spanning many dates and `list` is called with a `date` range `where`, an `orderBy`, and a `limit`
- **THEN** only records inside the range are returned, in the requested order, no more than `limit` of them

#### Scenario: A filter on a json field is refused, not misread

- **WHEN** `list` is called with a `where` condition on a `json`-typed field whose value happens to contain `gt`/`gte`/`lt`/`lte` keys (or any json equality condition), or with `orderBy` naming a `json`-typed field
- **THEN** the call fails with a structured `unqueryable_field` error `{kind, collection, field, hint}` — it is never silently reinterpreted as a range filter and never returns wrong rows
