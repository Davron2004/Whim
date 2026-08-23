## MODIFIED Requirements

### Requirement: Generation request and rewrite shapes
The contract SHALL define `GenerateRequest` (`prompt`, optional `clarifications`, optional `app` carrying the current `source`, the
`manifest`, the `schema`, and the `appliedSchema` for the edit flow — full re-send per Model 1, never wire
diffs) and `RewriteRequest`/`RewriteResponse` (`prompt` plus optional `clarifications` and optional `app` in, `rewrittenPrompt` plus optional `plan` out).

`clarifications` SHALL be an optional list of `{ id, question, answer }` entries — the answers the user gave to the clarify exchange's questions, carried by value so the server holds no per-device state between calls. Its absence and an empty list SHALL both mean "the user answered nothing", which is a legitimate, common state.

`RewriteRequest.app` SHALL be an optional context object `{ name, collections? }`, where `name` is the app's current display name and `collections` is an optional list of `{ name, fields }` carrying collection and field **display names only**. Its presence means "this rewrite describes a change to an existing app"; its absence means a new app. It SHALL NOT carry source, bundle text, burned ids, applied schemas, record contents, or any device-side identity — the rewrite turn answers in the user's own words and needs no more than names, and the payload stays small enough to ride the unary request.

`RewriteResponse.plan` SHALL be an optional ordered list of `{ label, text }` rows — the plan the device renders as its approval gate. When it is absent the device renders `rewrittenPrompt` as a single row, so a server that returns no rows stays conforming.

Within `app`, `source` SHALL be **optional**: it carries the app's original TypeScript when the device has
it, and is absent for a pre-existing install whose snapshots predate source tracking. Its absence means
exactly "the device has no original source for this app", and a conforming server SHALL regenerate under
the supplied `manifest`/`appliedSchema` rather than treat compiled output as source. `manifest` and
`schema` remain required within `app`.

`app.appliedSchema` SHALL be an optional record carrying the **accumulated** applied-schema union of the
database the app writes to — the storage group's `_meta` union, not the app's own snapshot artifact
(decision #52 D5). It is the diff baseline the harness's schema checks run against and the source of the
burned-ID allocation floor; when it is absent the baseline is the empty applied schema.

#### Scenario: Edit flow carries full source
- **WHEN** a client builds a `GenerateRequest` for editing an existing app whose original source it holds
- **THEN** the schema accepts the complete current source text (not a diff) inside `app`

#### Scenario: Edit flow without tracked source still validates
- **WHEN** a client builds a `GenerateRequest` for an app whose snapshots carry no original source
- **THEN** the request validates with `app.source` absent, and `app.manifest` and `app.schema` still present

#### Scenario: Applied schema is a distinct field from the app's own schema
- **WHEN** `GenerateRequest` is inspected
- **THEN** `app.schema` (the app's declared artifact) and `app.appliedSchema` (the database's accumulated
  union) are separate optional-vs-required fields that can legitimately differ

#### Scenario: A generation carries the answers the user gave
- **WHEN** a client builds a `GenerateRequest` after a clarify exchange the user answered
- **THEN** the request validates with each answered question's `id`, `question` and `answer` inside `clarifications`

#### Scenario: A rewrite for an existing app validates with its context
- **WHEN** a client builds a `RewriteRequest` for a re-prompt of an installed app
- **THEN** the request validates with `app.name` and the app's collection and field display names inside `app.collections`

#### Scenario: A rewrite context carries no source and no ids
- **WHEN** a `RewriteRequest` carrying `app` is inspected
- **THEN** it has no source, no bundle, no burned collection or field ids, and no record contents

#### Scenario: A rewrite without app context still validates
- **WHEN** a `RewriteRequest` carrying only `prompt` is parsed
- **THEN** it validates, and the server treats it as a new-app rewrite

#### Scenario: A rewrite without plan rows still validates
- **WHEN** a `RewriteResponse` carrying only `rewrittenPrompt` is parsed
- **THEN** it validates, and a client renders the single row
