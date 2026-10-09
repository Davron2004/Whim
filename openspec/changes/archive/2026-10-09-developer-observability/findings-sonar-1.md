# Sonar findings — PR #91 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #91
- gate: OK
- issues: 39

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — src/host/logging/diagnostics.ts:237 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S2 — deploy/provision.sh:331 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S3 — deploy/provision.sh:331 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S4 — src/host/logging/diagnostic.ts:47 — typescript:S7776 (MINOR)
`BUILTIN_ERROR_NAMES` should be a `Set`, and use `BUILTIN_ERROR_NAMES.has()` to check existence or non-existence.

## S5 — src/host/logging/diagnostic.ts:88 — typescript:S7776 (MINOR)
`HOST_SITES_ON_PAGE_CHANNEL` should be a `Set`, and use `HOST_SITES_ON_PAGE_CHANNEL.has()` to check existence or non-existence.

## S6 — src/host/logging/diagnostic.ts:167 — typescript:S7776 (MINOR)
`LEVELS` should be a `Set`, and use `LEVELS.has()` to check existence or non-existence.

## S7 — src/host/logging/diagnostics.ts:111 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S8 — src/host/logging/diagnostics.ts:281 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S9 — scripts/release/lib/store-listing.ts:726 — typescript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S10 — scripts/release/lib/store-listing.ts:752 — typescript:S7737 (MINOR)
Do not use an object literal as default for parameter `modules`.

## S11 — deploy/provision.sh:79 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S12 — deploy/provision.sh:86 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S13 — deploy/provision.sh:97 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S14 — deploy/provision.sh:97 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S15 — deploy/provision.sh:107 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S16 — deploy/provision.sh:108 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S17 — deploy/provision.sh:110 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S18 — deploy/provision.sh:112 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S19 — deploy/provision.sh:115 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S20 — deploy/provision.sh:118 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S21 — deploy/provision.sh:130 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S22 — deploy/provision.sh:132 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S23 — deploy/provision.sh:134 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S24 — deploy/provision.sh:145 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S25 — deploy/provision.sh:146 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S26 — deploy/provision.sh:146 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S27 — deploy/provision.sh:214 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S28 — deploy/provision.sh:263 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S29 — deploy/provision.sh:270 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S30 — deploy/provision.sh:274 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S31 — deploy/provision.sh:276 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S32 — deploy/provision.sh:279 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S33 — deploy/provision.sh:327 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S34 — deploy/smoke.sh:30 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S35 — deploy/smoke.sh:37 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S36 — deploy/smoke.sh:38 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S37 — deploy/vm/bootstrap.sh:75 — shelldre:S1192 (MINOR)
Define a constant instead of using the literal '=https' 4 times.

## S38 — deploy/vm/bootstrap.sh:79 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S39 — src/runtime/web/loader.js:101 — javascript:S2486 (MINOR)
Handle this exception, don't catch it at all, or explain in a comment why it is ignored.
GATE: OK
