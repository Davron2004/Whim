## MODIFIED Requirements

### Requirement: Every wire message carries a forward-compatibility envelope with a closed fallback vocabulary
Every SSE event and every unary JSON body (success or `ApiError`) SHALL be decodable in two phases: first as an envelope `{ type or error: string, compat?: { min: integer, fallback: 'skip' | 'fail' | 'update', notice?: string ≤ 200 chars } }` that tolerates unknown extra fields, then, only when the client knows the type or code and `compat.min` (default 1) is at most its level, as the full schema. A client that cannot use a message SHALL apply its fallback: `skip` ignores it and continues, `fail` ends the current flow with the failure screen showing `notice` as plain text (or generic copy), `update` ends the flow: a run in progress ends on the Failure page in its needs-a-newer-Whim kind, with `notice` kept as the failed record's reason, and any other flow (a clarify, rewrite or report response) ends on the update screen showing `notice`. An unknown message without `compat` SHALL be treated as `fail`, and an unknown fallback value SHALL be treated as `fail`. The set {skip, fail, update} SHALL never gain a member or change meaning. Known messages SHALL ignore unknown fields rather than reject them. A client SHALL read `null` on an optional field as the field left out, `compat` and `compat.notice` included (the contract reads those two the same way); `null` on a required field still fails: in `compat` (`min`, `fallback`) the client treats the message as `fail`, elsewhere the message fails its schema. A client SHALL drop an optional `result.summary` or rewrite `plan` that fails its shape and still use the message.

#### Scenario: Unknown non-essential event
- **WHEN** a client receives an SSE event of a type it does not know with `compat.fallback: 'skip'`
- **THEN** it ignores the event and the stream continues to its terminal event

#### Scenario: Unknown essential event
- **WHEN** a client receives an unknown event with `compat.fallback: 'update'` and a notice while a run is in progress
- **THEN** it stops the run and shows the Failure page in its needs-a-newer-Whim kind, keeps the notice as the failed record's reason, and nothing is installed

#### Scenario: Unknown essential response outside a run
- **WHEN** a client receives an unknown unary response with `compat.fallback: 'update'` and a notice
- **THEN** it stops the flow and shows the update screen with the notice, and nothing is installed

#### Scenario: Unknown refusal code
- **WHEN** a unary request returns an `ApiError` whose `error` the client does not know and `compat.fallback: 'fail'`
- **THEN** the client shows the failure screen with the notice as plain text

#### Scenario: New field on a known message
- **WHEN** a known event arrives with an extra field the client's schema lacks
- **THEN** the event is used and the field is ignored

#### Scenario: Unknown message without compat
- **WHEN** an unknown event arrives with no `compat`
- **THEN** the client treats it as `fail`

#### Scenario: Null on an optional field reads as absent
- **WHEN** a message carries `null` on an optional field, such as `compat: null` or `compat.notice: null`
- **THEN** the client reads it as the field left out: a known message with `compat: null` is decoded as one with no `compat`, an unknown one is treated as `fail`, and a `compat` with a null `notice` applies its fallback with no notice

#### Scenario: A null compat min or fallback is unreadable
- **WHEN** a message's `compat` carries `fallback: null` or `min: null`
- **THEN** the client cannot read the `compat` and treats the message as `fail`, even when it knows the type

#### Scenario: A malformed optional summary or plan is dropped
- **WHEN** a `result` event's optional `summary` or a rewrite response's optional `plan` fails its shape
- **THEN** the client drops that field and still uses the message: the app installs with no summary, and the plan step shows the rewritten prompt as its one row
