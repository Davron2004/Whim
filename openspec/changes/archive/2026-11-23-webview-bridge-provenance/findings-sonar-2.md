# Sonar findings — PR #309 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #309
- gate: OK
- issues: 7

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — src/runtime/web/probes.js:137 — javascript:S7721 (MAJOR)
Move function 'protoOf' to the outer scope.

## S2 — src/runtime/web/probes.js:170 — javascript:S4138 (MINOR)
Use a "for...of" loop, since the index is only used to read array elements.

## S3 — src/host/launcher/runtime-message-auth.ts:70 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S4 — src/host/launcher/runtime-message-auth.ts:70 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S5 — src/host/launcher/runtime-message-auth.ts:252 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S6 — src/runtime/web/loader.js:100 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S7 — src/runtime/web/neutralize.js:93 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.
GATE: OK
