# Sonar findings — PR #137 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #137
- gate: ERROR
- issues: 3

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — server/src/routes/generate.ts:698 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S2 — src/host/launcher/LauncherRoot.tsx:1106 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S3 — src/host/launcher/LauncherRoot.tsx:1058 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.
