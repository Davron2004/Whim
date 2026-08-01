# Sonar findings — PR #19 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #19
- gate: OK
- issues: 5

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — src/host/launcher/xhr-transport.ts:138 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S2 — server/test/server-core.suite.ts:657 — typescript:S7770 (MINOR)
arrow function is equivalent to `String`. Use `String` directly.

## S3 — server/test/server-core.suite.ts:668 — typescript:S6594 (MINOR)
Use the "RegExp.exec()" method instead.

## S4 — server/test/server-core.suite.ts:681 — typescript:S6594 (MINOR)
Use the "RegExp.exec()" method instead.

## S5 — server/test/server-core.suite.ts:701 — typescript:S6594 (MINOR)
Use the "RegExp.exec()" method instead.
