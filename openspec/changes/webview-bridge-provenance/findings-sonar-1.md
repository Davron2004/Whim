# Sonar findings — PR #309 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #309
- gate: OK
- issues: 13

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — src/runtime/web/probes.js:156 — javascript:S4138 (MINOR)
Use a "for...of" loop, since the index is only used to read array elements.

## S2 — src/host/launcher/runtime-message-auth.ts:70 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S3 — src/host/launcher/runtime-message-auth.ts:70 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S4 — src/host/launcher/runtime-message-auth.ts:252 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S5 — src/runtime/web/loader.js:100 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S6 — src/runtime/web/neutralize.js:45 — javascript:S3776 (CRITICAL)
Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.

## S7 — src/runtime/web/neutralize.js:53 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S8 — src/runtime/web/neutralize.js:82 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S9 — src/runtime/web/neutralize.js:84 — javascript:S2486 (MINOR)
Handle this exception, don't catch it at all, or explain in a comment why it is ignored.

## S10 — src/runtime/web/probes.js:16 — javascript:S3776 (CRITICAL)
Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed.

## S11 — src/runtime/web/probes.js:116 — javascript:S3776 (CRITICAL)
Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.

## S12 — src/runtime/web/probes.js:124 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S13 — src/runtime/web/probes.js:138 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.
GATE: OK
