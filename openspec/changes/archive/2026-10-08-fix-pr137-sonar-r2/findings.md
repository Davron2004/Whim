# Sonar findings — PR #137 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #137
- gate: OK
- issues: 44

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — server/src/admin/import-sqlite.ts:127 — typescript:S7503 (MINOR)
Async function 'keepEarliest' has no 'await' expression.

## S2 — server/src/admin/import-sqlite.ts:162 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S3 — deploy/cloudrun/deploy.sh:152 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S4 — server/src/admin/purge.ts:43 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S5 — server/src/admin/import-sqlite.ts:144 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S6 — server/src/admin/import-sqlite.ts:160 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S7 — server/src/admin/import-sqlite.ts:172 — typescript:S7503 (MINOR)
Async function 'rebuildDay' has no 'await' expression.

## S8 — server/src/admin/import-sqlite.ts:206 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S9 — server/src/firestore/usage-store.ts:109 — typescript:S7758 (MINOR)
Prefer `String#codePointAt()` over `String#charCodeAt()`.

## S10 — server/src/firestore/usage-store.ts:250 — typescript:S7503 (MINOR)
Async method 'admit' has no 'await' expression.

## S11 — server/src/firestore/usage-store.ts:446 — typescript:S1186 (CRITICAL)
Unexpected empty async method 'close'.

## S12 — server/src/stores.ts:99 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S13 — server/src/firestore/report-store.ts:102 — typescript:S1186 (CRITICAL)
Unexpected empty async method 'close'.

## S14 — server/src/firestore/waitlist-store.ts:65 — typescript:S7503 (MINOR)
Async method 'upsert' has no 'await' expression.

## S15 — server/src/firestore/waitlist-store.ts:85 — typescript:S7503 (MINOR)
Async method 'remove' has no 'await' expression.

## S16 — server/src/firestore/waitlist-store.ts:99 — typescript:S1186 (CRITICAL)
Unexpected empty async method 'close'.

## S17 — server/src/reports/store.ts:190 — typescript:S1186 (CRITICAL)
Unexpected empty async method 'close'.

## S18 — server/src/reports/store.ts:303 — typescript:S7503 (MINOR)
Async method 'close' has no 'await' expression.

## S19 — server/src/stores.ts:120 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S20 — server/src/stores.ts:139 — typescript:S4043 (MAJOR)
Move this array "reverse" operation to a separate statement or replace it with "toReversed".

## S21 — server/src/usage-store.ts:608 — typescript:S1186 (CRITICAL)
Unexpected empty async method 'close'.

## S22 — server/src/usage-store.ts:941 — typescript:S7503 (MINOR)
Async method 'close' has no 'await' expression.

## S23 — server/src/waitlist/store.ts:98 — typescript:S7503 (MINOR)
Async method 'upsert' has no 'await' expression.

## S24 — server/src/waitlist/store.ts:112 — typescript:S7503 (MINOR)
Async method 'export' has no 'await' expression.

## S25 — server/src/waitlist/store.ts:116 — typescript:S7503 (MINOR)
Async method 'remove' has no 'await' expression.

## S26 — server/src/waitlist/store.ts:120 — typescript:S7503 (MINOR)
Async method 'purge' has no 'await' expression.

## S27 — server/src/waitlist/store.ts:133 — typescript:S1186 (CRITICAL)
Unexpected empty async method 'close'.

## S28 — server/src/waitlist/store.ts:192 — typescript:S7503 (MINOR)
Async method 'upsert' has no 'await' expression.

## S29 — server/src/waitlist/store.ts:209 — typescript:S7503 (MINOR)
Async method 'export' has no 'await' expression.

## S30 — server/src/waitlist/store.ts:216 — typescript:S7503 (MINOR)
Async method 'remove' has no 'await' expression.

## S31 — server/src/waitlist/store.ts:220 — typescript:S7503 (MINOR)
Async method 'purge' has no 'await' expression.

## S32 — server/src/waitlist/store.ts:224 — typescript:S7503 (MINOR)
Async method 'close' has no 'await' expression.

## S33 — server/src/reports/store.ts:171 — typescript:S7503 (MINOR)
Async method 'listByDevice' has no 'await' expression.

## S34 — server/src/reports/store.ts:178 — typescript:S7503 (MINOR)
Async method 'deleteByDevice' has no 'await' expression.

## S35 — server/src/reports/store.ts:289 — typescript:S7503 (MINOR)
Async method 'listByDevice' has no 'await' expression.

## S36 — server/src/reports/store.ts:297 — typescript:S7503 (MINOR)
Async method 'deleteByDevice' has no 'await' expression.

## S37 — server/src/reports/store.ts:132 — typescript:S7503 (MINOR)
Async method 'insert' has no 'await' expression.

## S38 — server/src/reports/store.ts:147 — typescript:S7503 (MINOR)
Async method 'list' has no 'await' expression.

## S39 — server/src/reports/store.ts:156 — typescript:S7503 (MINOR)
Async method 'get' has no 'await' expression.

## S40 — server/src/reports/store.ts:160 — typescript:S7503 (MINOR)
Async method 'purgeOlderThan' has no 'await' expression.

## S41 — server/src/reports/store.ts:242 — typescript:S7503 (MINOR)
Async method 'insert' has no 'await' expression.

## S42 — server/src/reports/store.ts:260 — typescript:S7503 (MINOR)
Async method 'list' has no 'await' expression.

## S43 — server/src/reports/store.ts:276 — typescript:S7503 (MINOR)
Async method 'get' has no 'await' expression.

## S44 — server/src/reports/store.ts:284 — typescript:S7503 (MINOR)
Async method 'purgeOlderThan' has no 'await' expression.
