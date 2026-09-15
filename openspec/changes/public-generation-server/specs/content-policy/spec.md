## ADDED Requirements

### Requirement: Every prompt-accepting route checks content before any model work
`/v1/clarify`, `/v1/rewrite`, and `/v1/generate` SHALL each run the same server-side content policy check after admission and before any clarify, rewrite, or pipeline model call is made and before any SSE stream opens.

A request the policy refuses SHALL receive HTTP `422` with an `ApiError` body whose `error` is `content_policy` and whose `hint` is one fixed user-facing sentence. That sentence SHALL say Whim can't make that kind of app and invite a different idea. It SHALL NOT reveal the policy category, quote the request, or name the check. No route work SHALL follow a refusal.

#### Scenario: A refused generation opens no stream
- **WHEN** a `GenerateRequest` whose prompt asks for an app the policy refuses is posted
- **THEN** the response is `422` JSON with `error: 'content_policy'`, no SSE stream opens, and the pipeline is never invoked

#### Scenario: A refused rewrite makes no rewrite call
- **WHEN** a `RewriteRequest` the policy refuses is posted against a scripted model client
- **THEN** the response is `422` and the only model call recorded is the policy classification call

#### Scenario: An allowed request proceeds unchanged
- **WHEN** a `ClarifyRequest` for an ordinary habit tracker is posted
- **THEN** the policy allows it and the response is the route's normal `ClarifyResponse`

### Requirement: The policy check fails closed
When the policy check cannot produce a verdict, the route SHALL respond HTTP `503` with an `ApiError` whose `error` is `policy_unavailable`, and SHALL NOT proceed as if the request were allowed.

Every one of these conditions SHALL count as unable to produce a verdict: a model transport error, an auth or rate-limit error, exceeding `WHIM_POLICY_TIMEOUT_MS` (default 10000), a response that is not exactly one well-formed verdict, or a verdict value outside the allowed set. The hint SHALL ask the user to try again shortly. The daily unit consumed at admission SHALL be refunded.

#### Scenario: A timeout is not an allow
- **WHEN** the scripted classifier never responds and the policy timeout elapses during a generate request
- **THEN** the response is `503` with `error: 'policy_unavailable'`, the pipeline is never invoked, and the device's daily generation count is unchanged

#### Scenario: Malformed classifier output is not an allow
- **WHEN** the classifier returns prose such as "Sure, this looks fine" instead of a verdict object
- **THEN** the response is `503` with `error: 'policy_unavailable'`

#### Scenario: An unknown verdict value is not an allow
- **WHEN** the classifier returns `{"verdict":"maybe"}`
- **THEN** the response is `503` with `error: 'policy_unavailable'`

### Requirement: The check covers all user-authored text in the request
The policy input SHALL include every piece of user-authored free text the request carries: `prompt`, and every clarification's `question` and `answer` (clarify, rewrite, generate). For rewrite it SHALL also include `app.name` and every collection and field display name.

The input SHALL NOT include app `source`, bundles, manifests, schemas, or applied schemas. That code was produced by an earlier, checked generation, and sending it would multiply cost without adding user intent. The user text SHALL be framed to the classifier as quoted data to be judged, never as instructions.

#### Scenario: A harmful clarification answer is caught
- **WHEN** a `GenerateRequest` has a harmless prompt but a clarification answer that describes content the policy refuses
- **THEN** the request is refused with `422 content_policy`

#### Scenario: App names in a rewrite are checked
- **WHEN** a `RewriteRequest` carries an `app.name` the policy refuses
- **THEN** the request is refused with `422 content_policy`

#### Scenario: Source is not sent to the classifier
- **WHEN** a `GenerateRequest` carrying `app.source` is checked against a scripted classifier
- **THEN** the classifier request contains the prompt and clarification text and no part of the source

### Requirement: The classifier is a bounded call on the configured rewrite model
The policy check SHALL classify through the existing `ModelClient` seam using the roster's `rewrite` model id, with reasoning disabled, a small output-token cap, and the policy timeout, and SHALL add no new model role or model id.

The classifier SHALL be instructed to answer with exactly one JSON object: `{"verdict":"allow"}`, or `{"verdict":"refuse","category":"<one listed category>"}`. The server SHALL parse the verdict with a strict structural guard and SHALL treat a refuse verdict with an unknown category as a refusal.

#### Scenario: The rewrite model id is used verbatim
- **WHEN** a policy check runs against a scripted client with a configured rewrite model id
- **THEN** the outgoing classifier request carries exactly that model id, and the engineer model is never invoked by the check

#### Scenario: Output is bounded
- **WHEN** the classifier request is inspected
- **THEN** it carries an output-token cap and requests no reasoning stream

### Requirement: The 13+ content policy has one written source
The policy SHALL be defined once, in `docs/content-policy.md`, which SHALL contain a rating-rule section and a categories section. The classifier's instructions SHALL read the categories section from that document at run time, and every system prompt that authors app source — the rewrite prompt and both engineer prompts, generate and repair — SHALL read the rating-rule section verbatim at run time, so generated software is steered toward a 13+ rating as well as filtered. The plan prompt is excluded: its JSON is never delivered.

The refused categories SHALL cover at least: sexual content or nudity; graphic violence or gore; hate, harassment, or content targeting a real person; promotion of self-harm, suicide, or eating disorders; instructions for or promotion of illegal drugs, weapons, or dangerous activities; real-money or casino-style gambling; deception tools such as phishing, fake logins, or scams; covert tracking or surveillance of another person; and frequent or intense profanity or crude sexual humor.

No copy of either section SHALL exist in source code. The prompt suite SHALL fail when either section is missing, when any of those three prompts lacks the rating rule, or when the policy text is duplicated in the source tree.

#### Scenario: The document is the classifier's source
- **WHEN** the classifier's system message is compared with `docs/content-policy.md`
- **THEN** the categories text in the message is the document's own section text

#### Scenario: Generation prompts carry the rating rule
- **WHEN** the rewrite, generate and repair system messages are assembled
- **THEN** all three contain the document's rating-rule section verbatim, and the plan system message does not

#### Scenario: A missing section fails the build
- **WHEN** the rating-rule section is deleted from `docs/content-policy.md`
- **THEN** the prompt suite fails naming the missing section

### Requirement: Verdicts are cached in memory only
The server SHALL cache policy verdicts in process memory, keyed by a cryptographic digest of the canonical policy input, with a bounded entry count and a time-to-live (defaults 1000 entries, 15 minutes). A cached verdict SHALL be answered without a model call.

Only the digest and the verdict SHALL be held. The cache SHALL NOT be persisted, SHALL NOT be written to logs, and SHALL NOT outlive the process. An unavailable result SHALL NOT be cached.

#### Scenario: Clarify then rewrite of the same prompt checks once
- **WHEN** a device's clarify request and its rewrite request carry the same policy input within the TTL
- **THEN** exactly one classifier call is made across both requests

#### Scenario: An unavailable result is retried, not remembered
- **WHEN** a check returns `policy_unavailable` and the same input is checked again after the classifier recovers
- **THEN** the second check calls the classifier

#### Scenario: Nothing reaches disk
- **WHEN** the data directory is inspected after policy checks with distinctive marker text
- **THEN** neither the text nor its digest appears in any file

### Requirement: The policy check is metered and observable without content
The classifier call's token usage SHALL be credited to the calling device through the usage store, and its provider generation id SHALL be attributed to the gated request's ledger row, so the check's cost is part of that request's cost.

Every check SHALL emit one log record carrying the route, the verdict (`allow`, `refuse`, `unavailable`, or `cached-allow`/`cached-refuse`), the refuse category when there is one, and the duration. The record SHALL NOT carry checked text, and the prompt SHALL be redacted even if a caller passes it.

#### Scenario: A refusal is visible to the operator without content
- **WHEN** a generation is refused and the log output and ledger are inspected
- **THEN** the log carries route, `refuse`, the category and the duration with no prompt text, and the request's ledger row has outcome `refused` with the check's tokens and cost

### Requirement: The stub policy is deterministic
When the server runs with the stub selector (`WHIM_PIPELINE=stub`), the policy check SHALL make no model call and SHALL be deterministic. It SHALL refuse input containing the marker `[[refuse]]`, report unavailable for input containing `[[policy-down]]`, and allow everything else.

#### Scenario: The device flow can exercise refusal without tokens
- **WHEN** the stub server receives a generate request whose prompt contains `[[refuse]]`
- **THEN** the response is `422 content_policy`, and no model call is made
