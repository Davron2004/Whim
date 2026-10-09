## ADDED Requirements

### Requirement: Typed clarify answers are checked like the prompt
The content check on `/v1/rewrite` and `/v1/generate` SHALL classify every clarification's picked choices and typed `other` text together with the prompt, so a typed answer cannot carry text past the check that the prompt could not.

#### Scenario: Harmful text in an "Other" answer
- **WHEN** a rewrite request's prompt is benign but a clarification's `other` text violates the content policy
- **THEN** the request is refused exactly as if the prompt carried that text
