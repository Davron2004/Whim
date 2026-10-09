# Sonar findings — PR #90 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #90
- gate: OK
- issues: 26

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — deploy/deploy.sh:95 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S2 — deploy/deploy.sh:111 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S3 — src/host/launcher/age-check.ts:45 — typescript:S7776 (MINOR)
`AGE_SIGNALS` should be a `Set`, and use `AGE_SIGNALS.has()` to check existence or non-existence.

## S4 — deploy/vm/log-age-cap.sh:38 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S5 — deploy/vm/log-age-cap.sh:48 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S6 — deploy/vm/log-age-cap.sh:60 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S7 — deploy/vm/log-age-cap.sh:66 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S8 — deploy/vm/log-age-cap.sh:79 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S9 — deploy/vm/log-age-cap.sh:79 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S10 — src/host/launcher/LauncherRoot.tsx:577 — typescript:S6754 (MINOR)
useState call is not destructured into value + setter pair

## S11 — src/host/launcher/server-address.ts:61 — typescript:S2301 (MAJOR)
Provide multiple methods instead of using "internalBuild" to determine which action to take.

## S12 — server/src/site/legal-pages.ts:272 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S13 — server/src/site/legal-pages.ts:273 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S14 — server/src/site/legal-pages.ts:274 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S15 — server/src/site/legal-pages.ts:275 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S16 — server/src/site/legal-pages.ts:276 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S17 — server/src/site/legal-pages.ts:277 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S18 — server/src/site/legal-pages.ts:433 — typescript:S7778 (MINOR)
Do not call `Array#push()` multiple times.

## S19 — server/src/site/template.ts:43 — typescript:S7765 (MINOR)
Use `.includes()`, rather than `.indexOf()`, when checking for existence.

## S20 — server/src/site/template.ts:53 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S21 — server/src/site/template.ts:54 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S22 — server/src/site/template.ts:55 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S23 — server/src/site/template.ts:56 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S24 — server/src/site/template.ts:57 — typescript:S7781 (MINOR)
Prefer `String#replaceAll()` over `String#replace()`.

## S25 — server/src/lifecycle.ts:357 — typescript:S7778 (MINOR)
Do not call `Array#push()` multiple times.

## S26 — server/src/consent-practices.ts:28 — typescript:S7763 (MINOR)
Use `export…from` to re-export `PRACTICE_CATEGORIES`.
GATE: OK
