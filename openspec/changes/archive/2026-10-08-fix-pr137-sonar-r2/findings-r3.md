# Sonar findings — PR #137 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #137
- gate: OK
- issues: 9

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — server/src/admin/import-sqlite.ts:162 — typescript:S4123 (CRITICAL)
Unexpected iterable of non-Promise (non-"Thenable") values passed to promise aggregator.

## S2 — deploy/cloudrun/deploy.sh:250 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S3 — deploy/cloudrun/deploy.sh:250 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S4 — deploy/cloudrun/deploy.sh:240 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S5 — server/src/admin/import-sqlite.ts:162 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S6 — server/src/admin/import-sqlite.ts:144 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S7 — server/src/admin/import-sqlite.ts:160 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S8 — server/src/stores.ts:100 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S9 — server/src/stores.ts:121 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.
